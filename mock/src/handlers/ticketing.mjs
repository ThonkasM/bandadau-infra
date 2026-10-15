import { fail } from '../errors.mjs';
import { isStaff, ticketJwk, toTicket, toTicketDetail, verifyQr } from '../domain.mjs';
import { db } from '../state.mjs';
import { now, res, tsKey } from '../util.mjs';

export const ticketingHandlers = {
  async listMyTickets(c) {
    let list = [...db.tickets.values()].filter((t) => t.userId === c.user.id);
    if (c.query.status) list = list.filter((t) => t.status === c.query.status);
    const p = c.page(list, (t) => tsKey(t.issuedAt, t.id));
    return { items: p.items.map(toTicket), nextCursor: p.nextCursor };
  },

  async getTicketSigningKeys() { return { keys: [ticketJwk()] }; },

  async getTicket(c) {
    const t = db.tickets.get(c.params.ticketId);
    if (!t) throw c.notFound('Entrada');
    const ev = db.events.get(t.eventId);
    if (t.userId !== c.user.id && !isStaff(c.user) && ev?.organizerId !== c.user.id) throw fail('FORBIDDEN');
    return toTicketDetail(t);
  },

  async validateTicket(c) {
    c.requireRole('ORGANIZER', 'ADMIN');
    const claims = verifyQr(c.body.qrPayload);
    if (!claims) throw fail('INVALID_QR_SIGNATURE');
    const t = db.tickets.get(claims.tid);
    if (!t) throw c.notFound('Entrada');
    if (c.body.eventId && c.body.eventId !== t.eventId) throw fail('TICKET_EVENT_MISMATCH');
    const ev = db.events.get(t.eventId);
    if (!c.hasRole('ADMIN') && ev?.organizerId !== c.user.id) throw fail('NOT_EVENT_ORGANIZER');
    if (t.status === 'USED') throw fail('TICKET_ALREADY_USED', { extra: { ticketId: t.id, usedAt: t.usedAt } });
    if (t.status === 'VOIDED') throw fail('TICKET_VOIDED', { extra: { ticketId: t.id, usedAt: null } });
    Object.assign(t, { status: 'USED', usedAt: now() });
    return res(200, { result: 'VALID', ticket: toTicket(t) });
  },
};
