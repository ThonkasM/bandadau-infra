import { fail } from '../errors.mjs';
import { ledgerPost, notify, toLedger, walletOf } from '../domain.mjs';
import { BASE_URL } from '../config.mjs';
import { db } from '../state.mjs';
import { hmacHex, iso, now, res, tsKey, uuid } from '../util.mjs';

const PACKAGES = { CREDITS_20: 20, CREDITS_50: 50, CREDITS_100: 100 };
const view = (t) => ({ id: t.id, userId: t.userId, package: t.package, amountCredits: t.amountCredits, priceMinor: t.priceMinor, currency: t.currency, status: t.status, gatewayRef: t.gatewayRef, createdAt: t.createdAt, paidAt: t.paidAt ?? null, expiresAt: t.expiresAt });

export function applyTopUp(t, outcome) {
  if (t.status !== 'PENDING') return t;
  if (outcome === 'PAID') {
    t.status = 'PAID';
    t.paidAt = now();
    t.gatewayRef ??= `sim_${t.id.slice(0, 8)}`;
    ledgerPost(t.userId, 'TOPUP', t.amountCredits, `TOPUP:${t.id}`, `Recarga de ${t.amountCredits} créditos`, { topUpId: t.id });
    notify(t.userId, 'TOPUP_PAID', { credits: t.amountCredits }, '/wallet');
  } else {
    t.status = outcome === 'EXPIRED' ? 'EXPIRED' : 'FAILED';
  }
  return t;
}

export const walletHandlers = {
  async getMyWallet(c) { const w = walletOf(c.user.id); return { userId: w.userId, balanceCredits: w.balanceCredits, updatedAt: w.updatedAt }; },

  async listMyLedgerEntries(c) {
    let list = db.ledger.filter((e) => e.userId === c.user.id);
    if (c.query.type) list = list.filter((e) => e.type === c.query.type);
    const p = c.page(list, (e) => tsKey(e.createdAt, e.id));
    return { items: p.items.map(toLedger), nextCursor: p.nextCursor };
  },

  async createTopUp(c) {
    const credits = PACKAGES[c.body.package];
    const t = { id: uuid(), userId: c.user.id, package: c.body.package, amountCredits: credits, priceMinor: credits * 100, currency: 'BOB', status: 'PENDING', gatewayRef: null, createdAt: now(), paidAt: null, expiresAt: iso(Date.now() + 30 * 60_000) };
    db.topups.set(t.id, t);
    return res(201, { topUpId: t.id, checkoutUrl: `${BASE_URL}/mock-checkout/${t.id}`, package: t.package, amountCredits: t.amountCredits, priceMinor: t.priceMinor, currency: t.currency, status: t.status, expiresAt: t.expiresAt }, { Location: `/api/v1/wallet/topups/${t.id}` });
  },

  async getTopUp(c) {
    const t = db.topups.get(c.params.topUpId);
    if (!t) throw c.notFound('Recarga');
    if (t.userId !== c.user.id && !c.hasRole('ADMIN')) throw fail('FORBIDDEN');
    if (t.status === 'PENDING' && Date.parse(t.expiresAt) < Date.now()) t.status = 'EXPIRED';
    return view(t);
  },

  async simulateTopUpPayment(c) {
    const t = db.topups.get(c.params.topUpId);
    if (!t) throw c.notFound('Recarga');
    if (t.userId !== c.user.id) throw fail('FORBIDDEN');
    const outcome = c.body?.outcome ?? 'PAID';
    if (t.status === 'PENDING' && Date.parse(t.expiresAt) < Date.now()) t.status = 'EXPIRED';
    if (t.status !== 'PENDING' && t.status !== (outcome === 'PAID' ? 'PAID' : 'FAILED')) throw fail('TOPUP_NOT_PENDING');
    return view(applyTopUp(t, outcome));
  },

  async paymentWebhook(c) {
    const sig = c.req.headers['x-signature'];
    const expected = hmacHex('mock-webhook-secret', JSON.stringify(c.body));
    if (sig !== 'mock-signature' && sig !== expected && sig !== `sha256=${expected}`) throw fail('INVALID_SIGNATURE');
    const b = c.body;
    const t = db.topups.get(b.topUpId);
    if (!t) throw c.notFound('Recarga');
    const seen = (db.webhookEvents ??= new Set());
    const duplicate = seen.has(b.eventId);
    seen.add(b.eventId);
    if (!duplicate) {
      if (b.amountMinor !== t.priceMinor) throw fail('AMOUNT_MISMATCH');
      t.gatewayRef = b.gatewayRef;
      applyTopUp(t, b.status);
    }
    return { received: true, duplicate, topUpStatus: t.status };
  },
};
