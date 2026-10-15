import { ACCESS_TTL, BASE_URL, REFRESH_TTL, VERIFY_CODE } from '../config.mjs';
import { fail, fieldError } from '../errors.mjs';
import { notify, toUser } from '../domain.mjs';
import { db, asset } from '../state.mjs';
import { now, randomToken, res, sha256b64url, signJwt, uuid } from '../util.mjs';

const COOKIE = 'refresh_token';
const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;

/** Emite access JWT (HS256) + refresh opaco. web/admin → cookie HttpOnly; native → cuerpo. */
export function issueSession(user, client, family = uuid()) {
  const refresh = randomToken(32);
  db.refreshTokens.set(refresh, { userId: user.id, family, used: false, revoked: false, expiresAt: Date.now() + REFRESH_TTL * 1000 });
  const accessToken = signJwt({ sub: user.id, email: user.email, roles: user.roles, uid: user.universityId });
  const cookieMode = client === 'web' || client === 'admin';
  const body = { accessToken, refreshToken: cookieMode ? '' : refresh, tokenType: 'Bearer', expiresIn: ACCESS_TTL, refreshExpiresIn: REFRESH_TTL, user: toUser(user) };
  const headers = cookieMode ? { 'Set-Cookie': cookieHeader(refresh, REFRESH_TTL) } : {};
  return { body, headers };
}
const tokensResponse = (user, client, status = 200) => {
  const s = issueSession(user, client);
  return res(status, s.body, s.headers);
};

export const identityHandlers = {
  async registerUser(c) {
    const { email, password, universityId, locale } = c.body;
    const addr = email.toLowerCase();
    const uni = db.universities.get(universityId);
    if (!uni || !uni.enabled) throw fail('UNPROCESSABLE_ENTITY', { detail: 'La universidad no existe o no admite registros.' });
    if (password.length < 8) throw fail('VALIDATION_FAILED', { errors: [fieldError('password', 'TOO_SHORT', c.lang, '/password')] });
    if (db.byEmail.has(addr)) throw fail('EMAIL_ALREADY_REGISTERED');
    const domain = addr.split('@')[1];
    if (!uni.allowedDomains.includes(domain)) throw fail('EMAIL_DOMAIN_NOT_ALLOWED');
    const id = uuid();
    const name = addr.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\p{L}/gu, (m) => m.toUpperCase());
    db.users.set(id, {
      id, email: addr, password, universityId, status: 'PENDING_VERIFICATION', roles: ['STUDENT'], locale: locale ?? c.lang, theme: 'SYSTEM', emailVerifiedAt: null,
      createdAt: now(), updatedAt: now(), displayName: name, career: null, semester: null, interests: [], bio: null, avatarMediaId: null,
      avatarUrl: asset('/mock-assets/avatars/0.png'), suspendedAt: null, suspensionReason: null, verifyCode: VERIFY_CODE, verifyAttempts: 0,
    });
    db.byEmail.set(addr, id);
    return { userId: id, email: addr, status: 'PENDING_VERIFICATION', verificationExpiresIn: 900 };
  },

  async verifyEmail(c) {
    const u = db.users.get(db.byEmail.get(c.body.email.toLowerCase()));
    if (!u) throw fail('INVALID_VERIFICATION_CODE');
    if (u.status !== 'PENDING_VERIFICATION') throw fail('EMAIL_ALREADY_VERIFIED');
    if (u.verifyAttempts >= 5) throw fail('VERIFICATION_ATTEMPTS_EXCEEDED');
    if (c.body.code !== u.verifyCode) { u.verifyAttempts++; throw fail('INVALID_VERIFICATION_CODE'); }
    Object.assign(u, { status: 'ACTIVE', emailVerifiedAt: now(), updatedAt: now() });
    notify(u.id, 'WELCOME', {}, '/profile');
    return tokensResponse(u, c.client);
  },

  async resendVerificationCode(c) {
    const u = db.users.get(db.byEmail.get(c.body.email.toLowerCase()));
    if (u?.status === 'PENDING_VERIFICATION') u.verifyAttempts = 0;
    return res(202, undefined);
  },

  async login(c) {
    const u = db.users.get(db.byEmail.get(c.body.email.toLowerCase()));
    if (!u || u.password !== c.body.password) throw fail('INVALID_CREDENTIALS');
    if (u.status === 'PENDING_VERIFICATION') throw fail('EMAIL_NOT_VERIFIED');
    if (u.status === 'SUSPENDED') throw fail('ACCOUNT_SUSPENDED');
    if (u.status !== 'ACTIVE') throw fail('INVALID_CREDENTIALS');
    return tokensResponse(u, c.client);
  },

  async refreshToken(c) {
    const token = c.body?.refreshToken || c.cookie(COOKIE);
    const rec = token && db.refreshTokens.get(token);
    if (!rec || rec.revoked || rec.expiresAt < Date.now()) throw fail('INVALID_REFRESH_TOKEN');
    if (rec.used) {
      for (const r of db.refreshTokens.values()) if (r.family === rec.family) r.revoked = true;
      throw fail('REFRESH_TOKEN_REUSED');
    }
    rec.used = true;
    const u = db.users.get(rec.userId);
    if (!u || u.status !== 'ACTIVE') throw fail('INVALID_REFRESH_TOKEN');
    const s = issueSession(u, c.client, rec.family);
    return res(200, s.body, s.headers);
  },

  async logout(c) {
    const token = c.body?.refreshToken || c.cookie(COOKIE);
    const rec = token && db.refreshTokens.get(token);
    if (rec) for (const r of db.refreshTokens.values()) if (r.family === rec.family) r.revoked = true;
    return res(204, undefined, c.client !== 'native' ? { 'Set-Cookie': cookieHeader('', 0) } : {});
  },

  async createHandoffCode(c) {
    const { targetApp, codeChallenge, codeChallengeMethod } = c.body;
    if (codeChallengeMethod !== 'S256') throw fail('VALIDATION_FAILED', { errors: [fieldError('codeChallengeMethod', 'INVALID_VALUE', c.lang)] });
    if (targetApp === 'ADMIN') c.requireRole('MODERATOR', 'ADMIN');
    const code = 'hc_' + randomToken(24);
    db.handoffs.set(code, { userId: c.user.id, targetApp, challenge: codeChallenge, expiresAt: Date.now() + 60_000 });
    const origin = targetApp === 'ADMIN' ? (process.env.MOCK_ADMIN_URL ?? 'http://localhost:3001') : (process.env.MOCK_APP_URL ?? 'http://localhost:8081');
    return res(201, { code, redirectUrl: `${origin}/sso/callback?code=${code}`, expiresIn: 60 });
  },

  async exchangeHandoffCode(c) {
    const h = db.handoffs.get(c.body.code);
    db.handoffs.delete(c.body.code); // un solo uso, incluso si falla
    if (!h || h.expiresAt < Date.now() || sha256b64url(c.body.codeVerifier) !== h.challenge) throw fail('HANDOFF_CODE_INVALID');
    const u = db.users.get(h.userId);
    if (!u || u.status !== 'ACTIVE') throw fail('HANDOFF_CODE_INVALID');
    return tokensResponse(u, c.client === 'native' && h.targetApp === 'ADMIN' ? 'admin' : c.client);
  },

  async createMcpToken() { throw fail('FEATURE_DISABLED'); },
  async revokeMcpToken() { throw fail('FEATURE_DISABLED'); },

  async getMe(c) { return toUser(c.user); },

  async updateMyPreferences(c) {
    if (c.body.locale) c.user.locale = c.body.locale;
    if (c.body.theme) c.user.theme = c.body.theme;
    c.user.updatedAt = now();
    return toUser(c.user);
  },

  async listUniversities(c) {
    const p = c.page([...db.universities.values()].filter((u) => u.enabled), (u) => u.name, 'asc');
    return { items: p.items.map(({ id, name, allowedDomains, enabled }) => ({ id, name, allowedDomains, enabled })), nextCursor: p.nextCursor };
  },

  async getJwks() {
    return { keys: [{ kty: 'RSA', kid: 'mock-hs256', use: 'sig', alg: 'RS256', n: 'bW9jay1rZXktbm90LXJlYWwtdGhlLW1vY2stc2lnbnMtd2l0aC1ocy0yNTY', e: 'AQAB' }] };
  },
};
void BASE_URL;
