import { fail } from '../errors.mjs';
import { seatsTaken, startCancellation, startRegistrationSaga, toEvent, toRegistration } from '../domain.mjs';
import { asset, db } from '../state.mjs';
import { now, res, uuid } from '../util.mjs';

const ACTIVE = new Set(['PENDING', 'CONFIRMED', 'CANCELLATION_PENDING']);
const evKey = (e) => `${String(Date.parse(e.startsAt)).padStart(15, '0')}:${e.id}`;
const canManage = (c, ev) => c.hasRole('ADMIN') || ev.organizerId === c.user?.id;
const visibleEvent = (c, id) => {
  const ev = db.events.get(id);
  if (!ev || (ev.status === 'DRAFT' && !canManage(c, ev))) throw c.notFound('Evento');
  return ev;
};

export const eventsHandlers = {
  async createEvent(c) {
    c.requireRole('ORGANIZER', 'ADMIN');
    const b = c.body;
    if (Date.parse(b.startsAt) <= Date.now()) throw fail('STARTS_AT_IN_PAST');
    const ev = {
      id: uuid(), organizerId: c.user.id, title: b.title, description: b.description, coverUrl: asset(`/mock-assets/events/${(db.events.size % 5) + 1}.png`), startsAt: b.startsAt,
      venue: b.venue, capacity: b.capacity, baseTaken: 0, priceCredits: b.priceCredits, status: 'DRAFT', publishedAt: null, createdAt: now(), updatedAt: now(),
    };
    db.events.set(ev.id, ev);
    return res(201, toEvent(ev), { Location: `/api/v1/events/${ev.id}` });
  },

  async listEvents(c) {
    const q = c.query;
    let list = [...db.events.values()].filter((e) => e.status !== 'DRAFT' || canManage(c, e));
    if (q.public === 'true') list = list.filter((e) => e.status === 'PUBLISHED');
    if (q.status) list = list.filter((e) => e.status === q.status);
    if (q.organizerId) list = list.filter((e) => e.organizerId === q.organizerId);
    if (q.from) list = list.filter((e) => Date.parse(e.startsAt) >= Date.parse(q.from));
    if (q.to) list = list.filter((e) => Date.parse(e.startsAt) <= Date.parse(q.to));
    const p = c.page(list, evKey, 'asc');
    return { items: p.items.map(toEvent), nextCursor: p.nextCursor };
  },

  async getEvent(c) { return toEvent(visibleEvent(c, c.params.eventId)); },

  async publishEvent(c) {
    const ev = visibleEvent(c, c.params.eventId);
    if (!canManage(c, ev)) throw fail('FORBIDDEN');
    if (ev.status !== 'DRAFT') throw fail('INVALID_EVENT_STATUS');
    if (Date.parse(ev.startsAt) <= Date.now()) throw fail('STARTS_AT_IN_PAST');
    Object.assign(ev, { status: 'PUBLISHED', publishedAt: now(), updatedAt: now() });
    return toEvent(ev);
  },

  async cancelEvent(c) {
    const ev = visibleEvent(c, c.params.eventId);
    if (!canManage(c, ev)) throw fail('FORBIDDEN');
    if (ev.status !== 'PUBLISHED' && ev.status !== 'DRAFT') throw fail('INVALID_EVENT_STATUS');
    Object.assign(ev, { status: 'CANCELLED', updatedAt: now() });
    for (const r of db.registrations.values()) if (r.eventId === ev.id && (r.status === 'CONFIRMED' || r.status === 'PENDING')) startCancellation(r, 'EVENT_CANCELLED');
    return res(202, toEvent(ev));
  },

  async registerToEvent(c) {
    const ev = visibleEvent(c, c.params.eventId);
    if (ev.status !== 'PUBLISHED' || Date.parse(ev.startsAt) <= Date.now()) throw fail('EVENT_NOT_OPEN');
    if ([...db.registrations.values()].some((r) => r.eventId === ev.id && r.userId === c.user.id && (r.status === 'PENDING' || r.status === 'CONFIRMED'))) throw fail('ALREADY_REGISTERED');
    if (seatsTaken(ev) >= ev.capacity) throw fail('EVENT_FULL', { headers: { 'Retry-After': '30' } });
    const r = { id: uuid(), eventId: ev.id, userId: c.user.id, status: 'PENDING', failureReason: null, priceCredits: ev.priceCredits, ticketId: null, createdAt: now(), updatedAt: now(), confirmedAt: null, cancelledAt: null };
    db.registrations.set(r.id, r);
    startRegistrationSaga(r);
    return res(202, toRegistration(r), { Location: `/api/v1/registrations/${r.id}`, 'Retry-After': '1' });
  },

  async listMyRegistrations(c) {
    let list = [...db.registrations.values()].filter((r) => r.userId === c.user.id);
    if (c.query.status) list = list.filter((r) => r.status === c.query.status);
    const p = c.page(list, (r) => `${String(Date.parse(r.createdAt)).padStart(15, '0')}:${r.id}`);
    return { items: p.items.map(toRegistration), nextCursor: p.nextCursor };
  },

  async getRegistration(c) {
    const r = db.registrations.get(c.params.registrationId);
    const ev = r && db.events.get(r.eventId);
    if (!r || (r.userId !== c.user.id && !c.hasRole('ADMIN') && ev.organizerId !== c.user.id)) throw c.notFound('Inscripción');
    const pending = r.status === 'PENDING' || r.status === 'CANCELLATION_PENDING';
    return res(200, toRegistration(r), pending ? { 'Retry-After': '1' } : {});
  },

  async cancelRegistration(c) {
    const r = db.registrations.get(c.params.registrationId);
    if (!r) throw c.notFound('Inscripción');
    if (r.userId !== c.user.id && !c.hasRole('ADMIN')) throw fail('FORBIDDEN');
    if (r.status !== 'CONFIRMED') throw fail('INVALID_REGISTRATION_STATUS');
    if (Date.parse(db.events.get(r.eventId).startsAt) - Date.now() < 3_600_000) throw fail('CANCELLATION_WINDOW_CLOSED');
    startCancellation(r);
    return res(202, toRegistration(r), { 'Retry-After': '1' });
  },
};
void ACTIVE;
