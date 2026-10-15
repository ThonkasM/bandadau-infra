// Datos de demo del contrato de la fase 1 (§3.5).
export const UNIVERSITIES = [
  { code: 'UMSA', name: 'Universidad Mayor de San Andrés', domain: 'umsa.edu.bo' },
  { code: 'UCB', name: 'Universidad Católica Boliviana', domain: 'ucb.edu.bo' },
];

export const USERS = [
  { key: 'admin', email: 'admin@umsa.edu.bo', roles: ['STUDENT', 'ADMIN'] },
  { key: 'mod', email: 'mod@umsa.edu.bo', roles: ['STUDENT', 'MODERATOR'] },
  { key: 'org', email: 'org@umsa.edu.bo', roles: ['STUDENT', 'ORGANIZER'] },
  { key: 'org2', email: 'org2@umsa.edu.bo', roles: ['STUDENT', 'ORGANIZER'] }, // segundo organizador: el smoke prueba que NO puede validar tickets ajenos
  { key: 'lucia', email: 'lucia@umsa.edu.bo', roles: ['STUDENT'] },
  { key: 'marco', email: 'marco@umsa.edu.bo', roles: ['STUDENT'] },
];

export const GROUP = { name: 'Ingeniería de Software II', subject: 'Ingeniería de Software', privacy: 'PUBLIC' };

export const POSTS = [
  { author: 'lucia', slug: 'welcome', text: '¡Hola Bandada! Primer día en la U. #bienvenida #umsa', visibility: 'PUBLIC' },
  { author: 'marco', slug: 'study', text: '¿Alguien arma un grupo de estudio para Ingeniería de Software II? #estudio', visibility: 'PUBLIC' },
  { author: 'lucia', slug: 'group', text: 'Resumen de la clase de ICONIX en el grupo. #iconix', visibility: 'GROUP' },
];

const days = (n) => new Date(Date.now() + n * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const EVENTS = [
  { title: 'Taller gratuito de Git y GitHub', description: 'Aprende ramas, pull requests y flujo de trabajo en equipo. Trae tu laptop.', venue: 'Laboratorio 3, Facultad de Ingeniería, UMSA', capacity: 50, priceCredits: 0, startsAt: () => days(7) },
  { title: 'Taller de Docker (20 créditos)', description: 'Contenedores desde cero: imágenes, redes y Compose.', venue: 'Auditorio de la Facultad de Ingeniería, UMSA', capacity: 40, priceCredits: 20, startsAt: () => days(14) },
  { title: 'Charla magistral (cupo 1)', description: 'Evento de cupo único para probar el caso EVENT_FULL.', venue: 'Sala de reuniones, Centro de Estudiantes', capacity: 1, priceCredits: 0, startsAt: () => days(21) },
];
