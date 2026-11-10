// Historial de demo para los reportes: eventos pasados y próximos con inscripciones (SAGA real), fallos,
// cancelaciones con compensación y asistencia. `daysAgo` > 0 = evento realizado (se mueve en el tiempo con
// saga-history-backdate.mjs); `daysAhead` > 0 = evento próximo (queda con fecha futura). Sigue SEED_PROFILE (uagrm).
import { USERS } from './demo-data.mjs';

export const email = (key) => USERS.find((u) => u.key === key)?.email;

// Orden: del evento más antiguo al más reciente (las inscripciones se ejecutan en este orden).
const BASE_EVENTS = [
  { key: 'bienvenida', title: 'Bienvenida a nuevos estudiantes', description: 'Recorrido por el campus, presentación de centros de estudiantes y café de bienvenida.', venue: 'Auditorio Principal', capacity: 60, priceCredits: 0, by: 'org', daysAgo: 27, regs: ['lucia', 'marco', 'sofia', 'diego', 'camila', 'jorge', 'cesar', 'diegoy'] },
  { key: 'git', title: 'Taller de Git y GitHub (edición de octubre)', description: 'Ramas, pull requests y flujo de trabajo en equipo.', venue: 'Laboratorio 3', capacity: 40, priceCredits: 10, by: 'org', daysAgo: 20, regs: ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar'], cancels: ['marco'] },
  { key: 'proyectos', title: 'Noche de proyectos de Ingeniería', description: 'Demos de proyectos de Ingeniería de Software con jurado invitado. Cupo reducido.', venue: 'Sala Magna', capacity: 5, priceCredits: 15, by: 'org2', daysAgo: 13, regs: ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar', 'diegoy'] },
  { key: 'portafolio', title: 'Workshop de portafolio profesional', description: 'Arma tu portafolio y tu perfil técnico para tus primeras prácticas.', venue: 'Laboratorio 5', capacity: 20, priceCredits: 50, by: 'org', daysAgo: 7, regs: ['lucia', 'marco', 'diego', 'jorge', 'camila'] },
  { key: 'ia', title: 'Meetup de IA y agentes', description: 'Casos reales de agentes con MCP y reportes generativos.', venue: 'Sala de Conferencias', capacity: 50, priceCredits: 0, by: 'org2', daysAgo: 3, regs: ['lucia', 'marco', 'diego', 'jorge', 'cesar', 'diegoy'] },
  { key: 'demo-day', title: 'Demo Day de proyectos', description: 'Presentación final de los proyectos del semestre.', venue: 'Auditorio Principal', capacity: 80, priceCredits: 5, by: 'org2', daysAhead: 2, regs: ['lucia', 'sofia', 'jorge', 'cesar'] },
  { key: 'hack', title: 'Hackathon de verano', description: 'Cupo limitado: 24 horas de desarrollo en equipos.', venue: 'Patio Central', capacity: 3, priceCredits: 20, by: 'org', daysAhead: 6, regs: ['marco', 'diego', 'sofia', 'camila'] },
];

// Segundo conjunto (HISTORY_SET=week): movimiento de la SEMANA ANTERIOR con estudiantes nuevos. Las inscripciones se
// reparten en los 1-2 días previos a cada evento (`regLead`) para que haya créditos usados ayer y hoy; los eventos
// próximos se inscriben "ahora" (hoy). Corre DESPUÉS del conjunto base y no lo modifica.
export const WEEK_USERS = ['ana', 'bruno', 'carla', 'david', 'elena', 'fabio'];
const WEEK_EVENTS = [
  { key: 'w-cafe', title: 'Café y código: sesión de estudio', description: 'Estudio colaborativo con café: algoritmos y bases de datos.', venue: 'Biblioteca Central', capacity: 30, priceCredits: 0, by: 'org', daysAgo: 6, regLead: 2, regs: ['ana', 'bruno', 'carla', 'lucia', 'jorge'] },
  { key: 'w-carreras', title: 'Charla: carreras en tecnología', description: 'Egresados cuentan cómo entraron a su primer empleo en software.', venue: 'Sala de Conferencias', capacity: 50, priceCredits: 5, by: 'org2', daysAgo: 5, regLead: 2, regs: ['ana', 'bruno', 'david', 'elena', 'sofia', 'cesar'] },
  { key: 'w-sql', title: 'Taller práctico de SQL', description: 'Consultas, índices y planes de ejecución con casos reales.', venue: 'Laboratorio 2', capacity: 6, priceCredits: 10, by: 'org', daysAgo: 4, regLead: 2, regs: ['ana', 'carla', 'david', 'fabio', 'diego', 'jorge', 'lucia'] },
  { key: 'w-ajedrez', title: 'Torneo de ajedrez universitario', description: 'Torneo suizo abierto a todas las carreras.', venue: 'Patio Central', capacity: 24, priceCredits: 0, by: 'org2', daysAgo: 3, regLead: 2, regs: ['bruno', 'carla', 'elena', 'fabio', 'marco', 'camila', 'diegoy'] },
  { key: 'w-figma', title: 'Taller de diseño con Figma', description: 'De boceto a prototipo navegable en una tarde.', venue: 'Laboratorio 5', capacity: 25, priceCredits: 15, by: 'org', daysAgo: 2, regLead: 2, regs: ['ana', 'bruno', 'elena', 'fabio', 'sofia', 'cesar', 'diegoy'], cancels: ['bruno'] },
  { key: 'w-feria', title: 'Feria de emprendimiento', description: 'Stands de proyectos estudiantiles y rueda de inversionistas.', venue: 'Auditorio Principal', capacity: 80, priceCredits: 10, by: 'org2', daysAgo: 1, regLead: 1, regs: ['ana', 'bruno', 'carla', 'david', 'elena', 'fabio', 'lucia', 'marco', 'diego', 'jorge'] },
  { key: 'w-ciber', title: 'Charla de ciberseguridad', description: 'Buenas prácticas, contraseñas y phishing en la vida universitaria.', venue: 'Sala Magna', capacity: 60, priceCredits: 10, by: 'org', daysAhead: 3, regs: ['ana', 'carla', 'david', 'fabio', 'lucia', 'jorge', 'cesar'] },
  { key: 'w-maraton', title: 'Maratón de programación', description: 'Cupo reducido: equipos de 3, problemas de lógica y estructuras de datos.', venue: 'Laboratorio 3', capacity: 4, priceCredits: 20, by: 'org2', daysAhead: 5, regs: ['bruno', 'david', 'fabio', 'elena', 'diego'] },
];

// Recargas (`ago` = días atrás; 0 = ahora): `n` distingue la clave de idempotencia.
const BASE_TOPUPS = ['lucia', 'marco', 'sofia', 'diego', 'jorge', 'cesar', 'diegoy'].flatMap((user) => [{ user, n: 1, ago: 31 }, { user, n: 2, ago: 11 }]);
const WEEK_TOPUPS = [
  ...WEEK_USERS.map((user) => ({ user, n: 1, ago: 9 })),
  ...['ana', 'carla', 'david'].map((user) => ({ user, n: 2, ago: 4 })),
  ...['bruno', 'elena', 'fabio'].map((user) => ({ user, n: 2, ago: 1 })),
  ...['ana', 'david', 'fabio', 'lucia', 'jorge'].map((user) => ({ user, n: 3, ago: 0 })),
];

const week = process.env.HISTORY_SET === 'week';
export const HISTORY_EVENTS = week ? WEEK_EVENTS : BASE_EVENTS;
export const HISTORY_TOPUPS = week ? WEEK_TOPUPS : BASE_TOPUPS;
export const HISTORY_NEW_USERS = week ? WEEK_USERS : [];
export const topupKey = (user, n) => `seed:history:topup:${user}:${n}`;
export const regKey = (user, ev) => `seed:history:reg:${user}:${ev}${process.env.SEED_KEY_SALT ?? ''}`;
