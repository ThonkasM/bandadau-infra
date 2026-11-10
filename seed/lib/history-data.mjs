// Historial de demo para los reportes: eventos pasados y próximos con inscripciones (SAGA real), fallos,
// cancelaciones con compensación y asistencia. `daysAgo` > 0 = evento realizado (se mueve en el tiempo con
// saga-history-backdate.mjs); `daysAhead` > 0 = evento próximo (queda con fecha futura). Sigue SEED_PROFILE (uagrm).
import { USERS } from './demo-data.mjs';

export const email = (key) => USERS.find((u) => u.key === key)?.email;

// Orden: del evento más antiguo al más reciente (las inscripciones se ejecutan en este orden).
export const HISTORY_EVENTS = [
  { key: 'bienvenida', title: 'Bienvenida a nuevos estudiantes', description: 'Recorrido por el campus, presentación de centros de estudiantes y café de bienvenida.', venue: 'Auditorio Principal', capacity: 60, priceCredits: 0, by: 'org', daysAgo: 27, regs: ['lucia', 'marco', 'sofia', 'diego', 'camila', 'jorge', 'cesar', 'diegoy'] },
  { key: 'git', title: 'Taller de Git y GitHub (edición de octubre)', description: 'Ramas, pull requests y flujo de trabajo en equipo.', venue: 'Laboratorio 3', capacity: 40, priceCredits: 10, by: 'org', daysAgo: 20, regs: ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar'], cancels: ['marco'] },
  { key: 'proyectos', title: 'Noche de proyectos de Ingeniería', description: 'Demos de proyectos de Ingeniería de Software con jurado invitado. Cupo reducido.', venue: 'Sala Magna', capacity: 5, priceCredits: 15, by: 'org2', daysAgo: 13, regs: ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar', 'diegoy'] },
  { key: 'portafolio', title: 'Workshop de portafolio profesional', description: 'Arma tu portafolio y tu perfil técnico para tus primeras prácticas.', venue: 'Laboratorio 5', capacity: 20, priceCredits: 50, by: 'org', daysAgo: 7, regs: ['lucia', 'marco', 'diego', 'jorge', 'camila'] },
  { key: 'ia', title: 'Meetup de IA y agentes', description: 'Casos reales de agentes con MCP y reportes generativos.', venue: 'Sala de Conferencias', capacity: 50, priceCredits: 0, by: 'org2', daysAgo: 3, regs: ['lucia', 'marco', 'diego', 'jorge', 'cesar', 'diegoy'] },
  { key: 'demo-day', title: 'Demo Day de proyectos', description: 'Presentación final de los proyectos del semestre.', venue: 'Auditorio Principal', capacity: 80, priceCredits: 5, by: 'org2', daysAhead: 2, regs: ['lucia', 'sofia', 'jorge', 'cesar'] },
  { key: 'hack', title: 'Hackathon de verano', description: 'Cupo limitado: 24 horas de desarrollo en equipos.', venue: 'Patio Central', capacity: 3, priceCredits: 20, by: 'org', daysAhead: 6, regs: ['marco', 'diego', 'sofia', 'camila'] },
];

// Recargas: cada usuario carga 2 × CREDITS_100 (la segunda antes del 4.º evento) para que alcance a todos los pagos.
export const HISTORY_TOPUP_USERS = ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar', 'diegoy'];
export const topupKey = (user, n) => `seed:history:topup:${user}:${n}`;
export const regKey = (user, ev) => `seed:history:reg:${user}:${ev}${process.env.SEED_KEY_SALT ?? ''}`;
