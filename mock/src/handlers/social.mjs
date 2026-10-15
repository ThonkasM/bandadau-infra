import { fail } from '../errors.mjs';
import {
  canSeePost, emitQueue, isFollowing, isMember, isStaff, notify, openReportsFor, postOfComment, queueItems, summary, toPost, toProfile,
} from '../domain.mjs';
import { asset, db } from '../state.mjs';
import { now, parseHashtags, res, tsKey, uuid } from '../util.mjs';

const user404 = (c, id) => { const u = db.users.get(id); if (!u || u.status === 'DELETED') throw c.notFound('Usuario'); return u; };
const visiblePost = (c, id) => { const p = db.posts.get(id); if (!p || !canSeePost(p, c.user)) throw c.notFound('Publicación'); return p; };
const postKey = (p) => tsKey(p.createdAt, p.id);
const pageOfPosts = (c, posts) => { const p = c.page(posts, postKey); return { items: p.items.map((x) => toPost(x, c.user.id)), nextCursor: p.nextCursor }; };

const toGroup = (g, viewerId) => {
  const m = db.memberships.get(`${g.id}:${viewerId}`);
  return {
    id: g.id, name: g.name, subject: g.subject, privacy: g.privacy, ownerId: g.ownerId,
    membersCount: [...db.memberships.values()].filter((x) => x.groupId === g.id && x.status === 'ACTIVE').length,
    myMembership: m ? { role: m.role, status: m.status } : null, createdAt: g.createdAt,
  };
};
const toMembership = (m) => ({ groupId: m.groupId, userId: m.userId, role: m.role, status: m.status, profile: summary(m.userId), requestedAt: m.requestedAt, updatedAt: m.updatedAt });
const group404 = (c, id) => { const g = db.groups.get(id); if (!g) throw c.notFound('Grupo'); return g; };
const toComment = (cm) => {
  const out = { id: cm.id, postId: cm.postId, authorId: cm.authorId, author: summary(cm.authorId), text: cm.text, status: cm.status, createdAt: cm.createdAt };
  if (cm.parentId) out.parentId = cm.parentId;
  out.replyCount = (db.comments.get(cm.postId) ?? []).filter((x) => x.parentId === cm.id && x.status === 'VISIBLE').length;
  return out;
};
const toReport = ({ resolvedBy, ...r }) => r;

export const socialHandlers = {
  // ---------------------------------------------------------------- perfiles
  async getMyProfile(c) { return toProfile(c.user, c.user.id); },
  async updateMyProfile(c) {
    const b = c.body;
    for (const k of ['displayName', 'career', 'semester', 'bio', 'interests']) if (k in b) c.user[k] = b[k];
    if ('avatarMediaId' in b) {
      if (b.avatarMediaId === null) Object.assign(c.user, { avatarMediaId: null, avatarUrl: asset('/mock-assets/avatars/0.png') });
      else {
        const m = db.media.get(b.avatarMediaId);
        if (!m || m.ownerId !== c.user.id || m.purpose !== 'AVATAR') throw fail('MEDIA_NOT_FOUND');
        if (m.status !== 'APPROVED') throw fail('MEDIA_NOT_APPROVED');
        Object.assign(c.user, { avatarMediaId: m.id, avatarUrl: asset(m.path) });
      }
    }
    c.user.updatedAt = now();
    return toProfile(c.user, c.user.id);
  },
  async getProfile(c) { return toProfile(user404(c, c.params.userId), c.user.id); },

  // ---------------------------------------------------------------- posts
  async createPost(c) {
    const b = c.body;
    const dup = [...db.posts.values()].find((p) => p.clientId === b.clientId && p.authorId === c.user.id);
    if (dup) return res(200, toPost(dup, c.user.id));
    if (b.visibility === 'GROUP') {
      if (!b.groupId) throw fail('UNPROCESSABLE_ENTITY', { detail: 'visibility=GROUP requiere groupId.' });
      if (!db.groups.has(b.groupId) || !isMember(b.groupId, c.user.id)) throw fail('GROUP_MEMBERSHIP_REQUIRED');
    }
    const media = b.mediaIds.map((id) => db.media.get(id));
    if (media.some((m) => !m || m.ownerId !== c.user.id)) throw fail('MEDIA_NOT_FOUND');
    if (media.some((m) => m.status === 'REJECTED')) throw fail('MEDIA_NOT_APPROVED');
    const post = {
      id: uuid(), clientId: b.clientId, authorId: c.user.id, text: b.text, hashtags: parseHashtags(b.text), visibility: b.visibility, groupId: b.visibility === 'GROUP' ? b.groupId : null,
      status: media.every((m) => m.status === 'APPROVED') ? 'PUBLISHED' : 'PENDING_MEDIA', hiddenReason: null, mediaIds: b.mediaIds, createdAt: now(), updatedAt: now(),
    };
    db.posts.set(post.id, post);
    db.comments.set(post.id, []);
    db.reactions.set(post.id, new Map());
    return res(201, toPost(post, c.user.id), { Location: `/api/v1/posts/${post.id}` });
  },
  async getPost(c) { return toPost(visiblePost(c, c.params.postId), c.user.id); },
  async deletePost(c) {
    const p = db.posts.get(c.params.postId);
    if (!p || p.status === 'REMOVED') throw c.notFound('Publicación');
    if (p.authorId !== c.user.id && !isStaff(c.user)) throw fail('FORBIDDEN');
    Object.assign(p, { status: 'REMOVED', updatedAt: now() });
    return undefined;
  },

  async getFeed(c) {
    const items = [];
    for (const p of db.posts.values()) {
      if (p.status !== 'PUBLISHED') continue;
      let source = null;
      if (p.authorId === c.user.id) source = 'OWN';
      else if (p.visibility === 'GROUP') source = isMember(p.groupId, c.user.id) ? 'GROUP' : null;
      else if (p.visibility === 'FOLLOWERS') source = isFollowing(c.user.id, p.authorId) ? 'FOLLOWING' : null;
      else source = isFollowing(c.user.id, p.authorId) ? 'FOLLOWING' : 'RECOMMENDED';
      if (source) items.push({ p, source });
    }
    const pg = c.page(items, (i) => postKey(i.p));
    return {
      items: pg.items.map(({ p, source }) => ({ post: toPost(p, c.user.id), source, score: +Math.max(0, 1 - (Date.now() - Date.parse(p.createdAt)) / (30 * 86_400_000)).toFixed(4) })),
      nextCursor: pg.nextCursor,
    };
  },

  // ---------------------------------------------------------------- comentarios y reacciones
  async createComment(c) {
    const p = visiblePost(c, c.params.postId);
    if (p.status !== 'PUBLISHED') throw fail('POST_NOT_PUBLISHED');
    const list = db.comments.get(p.id);
    if (c.body.parentId && !list.some((x) => x.id === c.body.parentId)) throw fail('UNPROCESSABLE_ENTITY', { detail: 'parentId no pertenece a esta publicación.' });
    const cm = { id: uuid(), postId: p.id, authorId: c.user.id, text: c.body.text, status: 'VISIBLE', parentId: c.body.parentId ?? null, createdAt: now() };
    list.push(cm);
    if (p.authorId !== c.user.id) notify(p.authorId, 'NEW_COMMENT', { name: c.user.displayName }, `/posts/${p.id}`);
    return res(201, toComment(cm), { Location: `/api/v1/posts/${p.id}/comments/${cm.id}` });
  },
  async listComments(c) {
    const p = visiblePost(c, c.params.postId);
    const pg = c.page(db.comments.get(p.id).filter((x) => x.status === 'VISIBLE'), (x) => tsKey(x.createdAt, x.id), 'asc');
    return { items: pg.items.map(toComment), nextCursor: pg.nextCursor };
  },
  async setReaction(c) {
    const p = visiblePost(c, c.params.postId);
    const m = db.reactions.get(p.id);
    const had = m.has(c.user.id);
    m.set(c.user.id, c.body.type);
    if (!had && p.authorId !== c.user.id) notify(p.authorId, 'NEW_REACTION', { name: c.user.displayName }, `/posts/${p.id}`);
    const t = toPost(p, c.user.id);
    return { postId: p.id, myReaction: t.myReaction, reactionCounts: t.reactionCounts };
  },
  async removeReaction(c) {
    const p = visiblePost(c, c.params.postId);
    db.reactions.get(p.id).delete(c.user.id);
    return undefined;
  },

  // ---------------------------------------------------------------- follows
  async followUser(c) {
    const target = user404(c, c.params.userId);
    if (target.id === c.user.id) throw fail('CANNOT_FOLLOW_SELF');
    const key = `${c.user.id}>${target.id}`;
    if (!db.follows.has(key)) {
      db.follows.set(key, { followerId: c.user.id, followeeId: target.id, createdAt: now() });
      notify(target.id, 'NEW_FOLLOWER', { name: c.user.displayName }, `/profiles/${c.user.id}`);
    }
    return db.follows.get(key);
  },
  async unfollowUser(c) {
    user404(c, c.params.userId);
    db.follows.delete(`${c.user.id}>${c.params.userId}`);
    return undefined;
  },
  async getFollowSuggestions(c) {
    const items = [...db.users.values()]
      .filter((u) => u.id !== c.user.id && u.status === 'ACTIVE' && u.roles.includes('STUDENT') && !isFollowing(c.user.id, u.id))
      .map((u) => {
        const mutual = [...db.follows.values()].filter((f) => f.followerId === c.user.id && isFollowing(f.followeeId, u.id)).length;
        const reasons = [];
        if (u.career && u.career === c.user.career) reasons.push('SAME_CAREER');
        if (mutual) reasons.push('MUTUAL_FOLLOWS');
        if (u.interests.some((i) => c.user.interests.includes(i))) reasons.push('SHARED_INTERESTS');
        if ([...db.memberships.values()].some((m) => m.userId === u.id && m.status === 'ACTIVE' && isMember(m.groupId, c.user.id))) reasons.push('SHARED_GROUPS');
        return { profile: summary(u.id), career: u.career, score: +(reasons.length / 4 + mutual / 10).toFixed(2), reasons, mutualFollowsCount: mutual };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, c.limit);
    return { items, nextCursor: null };
  },

  // ---------------------------------------------------------------- grupos
  async createGroup(c) {
    if ([...db.groups.values()].some((g) => g.name.toLowerCase() === c.body.name.toLowerCase())) throw fail('GROUP_NAME_TAKEN');
    const g = { id: uuid(), name: c.body.name, subject: c.body.subject, privacy: c.body.privacy, ownerId: c.user.id, createdAt: now() };
    db.groups.set(g.id, g);
    db.memberships.set(`${g.id}:${c.user.id}`, { groupId: g.id, userId: c.user.id, role: 'OWNER', status: 'ACTIVE', requestedAt: now(), updatedAt: now() });
    return res(201, toGroup(g, c.user.id), { Location: `/api/v1/groups/${g.id}` });
  },
  async listGroups(c) {
    const q = String(c.query.query ?? '').toLowerCase();
    const list = [...db.groups.values()].filter((g) => !q || g.name.toLowerCase().includes(q) || g.subject.toLowerCase().includes(q));
    const pg = c.page(list, (g) => `${g.name.toLowerCase()}:${g.id}`, 'asc');
    return { items: pg.items.map((g) => toGroup(g, c.user.id)), nextCursor: pg.nextCursor };
  },
  async getGroup(c) { return toGroup(group404(c, c.params.groupId), c.user.id); },
  async joinGroup(c) {
    const g = group404(c, c.params.groupId);
    const key = `${g.id}:${c.user.id}`;
    let m = db.memberships.get(key);
    if (!m || m.status === 'LEFT' || m.status === 'REJECTED') {
      m = { groupId: g.id, userId: c.user.id, role: 'MEMBER', status: g.privacy === 'PUBLIC' ? 'ACTIVE' : 'PENDING', requestedAt: now(), updatedAt: now() };
      db.memberships.set(key, m);
      if (m.status === 'PENDING') notify(g.ownerId, 'GROUP_REQUEST', { name: c.user.displayName, group: g.name }, `/groups/${g.id}`);
    }
    return toMembership(m);
  },
  async listGroupMembers(c) {
    const g = group404(c, c.params.groupId);
    if (!isMember(g.id, c.user.id) && !isStaff(c.user)) throw fail('GROUP_MEMBERSHIP_REQUIRED');
    const status = c.query.status ?? 'ACTIVE';
    const pg = c.page([...db.memberships.values()].filter((m) => m.groupId === g.id && m.status === status), (m) => tsKey(m.requestedAt, m.userId), 'asc');
    return { items: pg.items.map(toMembership), nextCursor: pg.nextCursor };
  },
  async approveGroupMember(c) { return decide(c, 'ACTIVE'); },
  async rejectGroupMember(c) { return decide(c, 'REJECTED'); },
  async leaveGroup(c) {
    const g = group404(c, c.params.groupId);
    const m = db.memberships.get(`${g.id}:${c.user.id}`);
    if (!m) throw c.notFound('Membresía');
    if (m.role === 'OWNER') throw fail('OWNER_CANNOT_LEAVE');
    if (m.status !== 'ACTIVE' && m.status !== 'PENDING') throw fail('CONFLICT');
    Object.assign(m, { status: 'LEFT', updatedAt: now() });
    return toMembership(m);
  },
  async listGroupPosts(c) {
    const g = group404(c, c.params.groupId);
    if (!isMember(g.id, c.user.id) && !isStaff(c.user)) throw fail('GROUP_MEMBERSHIP_REQUIRED');
    return pageOfPosts(c, [...db.posts.values()].filter((p) => p.groupId === g.id && p.status === 'PUBLISHED'));
  },

  // ---------------------------------------------------------------- denuncias
  async reportContent(c) {
    const { targetType, targetId, reason, details } = c.body;
    const post = targetType === 'POST' ? db.posts.get(targetId) : postOfComment(targetId);
    const comment = targetType === 'COMMENT' ? db.comments.get(post?.id)?.find((x) => x.id === targetId) : null;
    if (!post || (targetType === 'COMMENT' && !comment) || !canSeePost(post, c.user)) throw c.notFound('Contenido');
    if ((comment?.authorId ?? post.authorId) === c.user.id) throw fail('CANNOT_REPORT_OWN_CONTENT');
    if ([...db.reports.values()].some((r) => r.targetId === targetId && r.reporterId === c.user.id)) throw fail('ALREADY_REPORTED');
    const first = openReportsFor(post.id).length === 0;
    const r = { id: uuid(), targetType, targetId, reporterId: c.user.id, reason, details: details ?? null, status: 'OPEN', resolution: null, resolutionNote: null, createdAt: now(), resolvedAt: null, resolvedBy: null };
    db.reports.set(r.id, r);
    if (openReportsFor(post.id).length >= 3 && post.status === 'PUBLISHED') Object.assign(post, { status: 'HIDDEN', hiddenReason: 'REPORTED', updatedAt: now() });
    emitQueue('ADDED', queueItems().find((i) => i.source === 'REPORTS' && i.id === post.id));
    void first;
    return res(201, toReport(r), { Location: `/api/v1/reports/${r.id}` });
  },
};

function decide(c, status) {
  const g = group404(c, c.params.groupId);
  const mine = db.memberships.get(`${g.id}:${c.user.id}`);
  if (!(mine?.status === 'ACTIVE' && (mine.role === 'OWNER' || mine.role === 'ADMIN')) && !c.hasRole('ADMIN')) throw fail('FORBIDDEN');
  const m = db.memberships.get(`${g.id}:${c.params.userId}`);
  if (!m) throw c.notFound('Solicitud');
  if (m.status !== 'PENDING') throw fail('MEMBERSHIP_NOT_PENDING');
  Object.assign(m, { status, updatedAt: now() });
  return toMembership(m);
}
