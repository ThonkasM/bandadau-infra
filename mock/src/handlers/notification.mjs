import { fail } from '../errors.mjs';
import { db } from '../state.mjs';
import { now, res } from '../util.mjs';
import { tsKey } from '../util.mjs';

const mine = (c) => db.notifications.filter((n) => n.userId === c.user.id);
const view = (n) => ({ id: n.id, userId: n.userId, type: n.type, title: n.title, body: n.body, locale: n.locale, data: n.data, readAt: n.readAt, createdAt: n.createdAt });
const prefsOf = (u) => {
  if (!db.prefs.has(u.id)) db.prefs.set(u.id, { userId: u.id, channels: { push: true, email: true, inApp: true }, mutedTypes: [], updatedAt: now() });
  return db.prefs.get(u.id);
};

export const notificationHandlers = {
  async listNotifications(c) {
    const all = mine(c);
    const unread = all.filter((n) => !n.readAt).length;
    const list = c.query.unreadOnly === 'true' ? all.filter((n) => !n.readAt) : all;
    const p = c.page(list, (n) => tsKey(n.createdAt, n.id));
    return res(200, { items: p.items.map(view), nextCursor: p.nextCursor }, { 'X-Unread-Count': String(unread) });
  },
  async markNotificationRead(c) {
    const n = db.notifications.find((x) => x.id === c.params.notificationId && x.userId === c.user.id);
    if (!n) throw c.notFound('Notificación');
    n.readAt ??= now();
    return view(n);
  },
  async markAllNotificationsRead(c) {
    const t = now();
    const unread = mine(c).filter((n) => !n.readAt);
    unread.forEach((n) => (n.readAt = t));
    return { updatedCount: unread.length, readAt: t };
  },
  async getNotificationPreferences(c) { return prefsOf(c.user); },
  async updateNotificationPreferences(c) {
    const p = prefsOf(c.user);
    Object.assign(p, { channels: c.body.channels, mutedTypes: c.body.mutedTypes, updatedAt: now() });
    return p;
  },
  async registerDevice(c) {
    const key = `${c.user.id}:${c.params.token}`;
    const prev = db.devices.get(key);
    const d = { token: c.params.token, userId: c.user.id, platform: c.body.platform, appVersion: c.body.appVersion ?? null, deviceName: c.body.deviceName ?? null, registeredAt: prev?.registeredAt ?? now(), lastSeenAt: now() };
    db.devices.set(key, d);
    return d;
  },
  async unregisterDevice(c) { db.devices.delete(`${c.user.id}:${c.params.token}`); return undefined; },
};
void fail;
