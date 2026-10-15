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
  { key: 'sofia', email: 'sofia@umsa.edu.bo', roles: ['STUDENT'] },
  { key: 'diego', email: 'diego@umsa.edu.bo', roles: ['STUDENT'] },
  { key: 'camila', email: 'camila@umsa.edu.bo', roles: ['STUDENT'] },
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

// ---- Datos ampliados (seed/extra.mjs): perfiles, publicaciones con foto, comentarios, eventos con portada, tickets ----
export const PROFILES = {
  admin: { displayName: 'Administración Bandada', career: 'Ingeniería de Sistemas', semester: 10, bio: 'Cuenta de administración de la plataforma.', interests: ['gestión', 'moderación'] },
  mod: { displayName: 'Moderación Bandada', career: 'Psicología', semester: 8, bio: 'Cuidamos la comunidad.', interests: ['comunidad'] },
  org: { displayName: 'Carlos Organizador', career: 'Ingeniería de Sistemas', semester: 9, bio: 'Organizo talleres y charlas de la carrera.', interests: ['eventos', 'devops', 'software'] },
  org2: { displayName: 'Valeria Eventos', career: 'Ingeniería Industrial', semester: 7, bio: 'Hackathons y ferias universitarias.', interests: ['hackathons', 'emprendimiento'] },
  lucia: { displayName: 'Lucía Mamani', career: 'Ingeniería de Sistemas', semester: 6, bio: 'Bases de datos, café y apuntes compartidos.', interests: ['bases de datos', 'diseño', 'música'] },
  marco: { displayName: 'Marco Rojas', career: 'Derecho', semester: 4, bio: 'Estudiando para ser el mejor abogado.', interests: ['debate', 'fútbol'] },
  sofia: { displayName: 'Sofía Quispe', career: 'Arquitectura', semester: 5, bio: 'Maquetas, planos y mucha cafeína.', interests: ['diseño', 'fotografía'] },
  diego: { displayName: 'Diego Flores', career: 'Ingeniería Electrónica', semester: 8, bio: 'Arduino, robótica y drones.', interests: ['robótica', 'iot'] },
  camila: { displayName: 'Camila Vargas', career: 'Medicina', semester: 3, bio: 'Anatomía y buenos hábitos de estudio.', interests: ['salud', 'running'] },
};

export const FOLLOWS = [
  ['lucia', 'marco'], ['marco', 'lucia'], ['lucia', 'sofia'], ['sofia', 'lucia'], ['diego', 'lucia'], ['camila', 'lucia'],
  ['lucia', 'org'], ['marco', 'org'], ['sofia', 'org2'], ['diego', 'org2'], ['camila', 'org'],
];

export const GROUPS_EXTRA = [
  { owner: 'sofia', name: 'Diseño y Arquitectura', subject: 'Diseño', privacy: 'PUBLIC', members: ['lucia', 'camila'] },
  { owner: 'diego', name: 'Robótica UMSA', subject: 'Electrónica', privacy: 'PUBLIC', members: ['lucia', 'marco'] },
];

// Colores de portada (RGB) por tema.
const BLUE = [[18, 56, 168], [10, 31, 102]];
const AMBER = [[255, 194, 26], [245, 161, 0]];
const SKY = [[26, 82, 214], [18, 56, 168]];
const NIGHT = [[10, 31, 102], [4, 16, 46]];
const TEAL = [[20, 140, 130], [12, 70, 100]];
const SUNSET = [[245, 120, 70], [140, 40, 110]];

export const POSTS_EXTRA = [
  { author: 'sofia', slug: 'maqueta', text: 'Terminando la maqueta del proyecto final. ¡Ya casi! #arquitectura #umsa', visibility: 'PUBLIC', image: { colors: SUNSET, seed: 11 } },
  { author: 'diego', slug: 'dron', text: 'Primer vuelo de nuestro dron con control PID. Gracias al equipo de Robótica 🚁 #robotica #iot', visibility: 'PUBLIC', image: { colors: SKY, seed: 12 } },
  { author: 'lucia', slug: 'apuntes-bd', text: 'Subí mis apuntes de Bases de Datos (normalización y SQL). ¡Úsenlos! #apuntes #basesdedatos', visibility: 'PUBLIC', image: { colors: BLUE, seed: 13 } },
  { author: 'camila', slug: 'running', text: 'Quién se suma a trotar mañana a las 6:30 en el campus? #running #salud', visibility: 'PUBLIC' },
  { author: 'marco', slug: 'debate', text: 'Se viene el torneo de debate interfacultades. Armamos equipo? #debate', visibility: 'PUBLIC', image: { colors: AMBER, seed: 14 } },
  { author: 'org', slug: 'git-workshop', text: 'Este viernes: Taller de Git y GitHub, cupos limitados. Inscríbete en Eventos. #taller #git', visibility: 'PUBLIC', image: { colors: NIGHT, seed: 15 } },
  { author: 'org2', slug: 'hackathon', text: '¡Se viene la Hackathon Bandada U! 24 horas, premios y mucha pizza. #hackathon', visibility: 'PUBLIC', image: { colors: TEAL, seed: 16 } },
  { author: 'sofia', slug: 'foto-campus', text: 'La luz del atardecer en el campus hoy estaba increíble.', visibility: 'PUBLIC', image: { colors: SUNSET, seed: 17 } },
  { author: 'diego', slug: 'oferta', text: 'Vendo kit Arduino Uno + sensores, casi nuevo. Escríbeme. #venta', visibility: 'PUBLIC' },
  { author: 'lucia', slug: 'cafe', text: 'Café en la biblioteca y a repasar para el parcial ☕ #estudio', visibility: 'PUBLIC' },
];

// Comentarios: [autor, slug del post, texto]
export const COMMENTS = [
  ['marco', 'apuntes-bd', '¡Gracias Lucía! Justo lo que necesitaba para el parcial.'],
  ['sofia', 'apuntes-bd', 'Muy claros, me sirvieron mucho. 🙌'],
  ['diego', 'apuntes-bd', '¿Tienes también los de Estructuras de Datos?'],
  ['lucia', 'dron', '¡Qué genial, Diego! ¿Cuándo lo muestran?'],
  ['camila', 'dron', 'Increíble el trabajo del equipo.'],
  ['lucia', 'maqueta', 'Se ve espectacular, Sofi.'],
  ['marco', 'debate', 'Cuenten conmigo, ya tengo la primera ronda lista.'],
  ['lucia', 'running', 'Me sumo, nos vemos en la entrada principal.'],
  ['sofia', 'hackathon', '¡Quiero participar! ¿Es por equipos?'],
  ['org2', 'hackathon', 'Sí Sofía, equipos de hasta 4 personas.'],
];

// Reacciones: [usuarios, slug, tipo]
export const REACTIONS = [
  [['lucia', 'marco', 'diego', 'camila'], 'maqueta', 'LIKE'],
  [['lucia', 'sofia', 'camila', 'marco', 'org'], 'dron', 'LIKE'],
  [['marco', 'sofia', 'diego', 'camila'], 'apuntes-bd', 'HELPFUL'],
  [['lucia', 'sofia'], 'debate', 'FUNNY'],
  [['lucia', 'marco', 'sofia', 'diego', 'camila'], 'hackathon', 'LIKE'],
  [['lucia', 'diego'], 'foto-campus', 'LIKE'],
  [['marco', 'camila'], 'git-workshop', 'LIKE'],
  [['sofia', 'marco'], 'running', 'SUPPORT'],
];

export const EVENTS_EXTRA = [
  { title: 'Hackathon Bandada U', description: '24 horas construyendo soluciones para la vida universitaria. Equipos de hasta 4 personas, mentores y premios.', venue: 'Auditorio Principal, UMSA', capacity: 120, priceCredits: 15, startsAt: () => days(12), by: 'org2', cover: { colors: TEAL, seed: 21 } },
  { title: 'Feria de Software 2026', description: 'Proyectos de estudiantes, demos en vivo y reclutadores de empresas locales.', venue: 'Patio Central, Facultad de Ingeniería', capacity: 300, priceCredits: 0, startsAt: () => days(18), by: 'org2', cover: { colors: SKY, seed: 22 } },
  { title: 'Charla: IA responsable en la universidad', description: 'Cómo usar la IA de forma ética en tus estudios y proyectos.', venue: 'Sala Magna, Edificio Central', capacity: 80, priceCredits: 5, startsAt: () => days(9), by: 'org', cover: { colors: NIGHT, seed: 23 } },
  { title: 'Taller de React Native', description: 'Construye tu primera app móvil con Expo, de cero a publicada.', venue: 'Laboratorio 5, Facultad de Ingeniería', capacity: 35, priceCredits: 25, startsAt: () => days(5), by: 'org', cover: { colors: BLUE, seed: 24 } },
  { title: 'Noche de Debate Interfacultades', description: 'Semifinal del torneo de debate con jurado invitado.', venue: 'Auditorio de Derecho', capacity: 150, priceCredits: 0, startsAt: () => days(26), by: 'org2', cover: { colors: AMBER, seed: 25 } },
  { title: 'Torneo de Ajedrez Relámpago', description: 'Inscríbete y mide tu nivel contra otros estudiantes. Premios para los 3 primeros.', venue: 'Cafetería Central', capacity: 48, priceCredits: 10, startsAt: () => days(16), by: 'org', cover: { colors: SUNSET, seed: 26 } },
];

// Inscripciones de demo: [usuario, título del evento]
export const REGISTRATIONS = [
  ['lucia', 'Taller de Docker (20 créditos)'],
  ['lucia', 'Hackathon Bandada U'],
  ['marco', 'Taller gratuito de Git y GitHub'],
  ['marco', 'Charla: IA responsable en la universidad'],
  ['sofia', 'Feria de Software 2026'],
  ['diego', 'Taller de React Native'],
];

// Recargas de demo: [usuario, paquete]
export const TOPUPS = [['marco', 'CREDITS_50'], ['sofia', 'CREDITS_50'], ['diego', 'CREDITS_100'], ['camila', 'CREDITS_20']];
