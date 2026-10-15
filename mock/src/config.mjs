export const PORT = Number(process.env.MOCK_PORT ?? process.env.PORT ?? 4010);
export const HOST = process.env.MOCK_HOST ?? '0.0.0.0';
export const BASE_URL = process.env.MOCK_PUBLIC_URL ?? `http://localhost:${PORT}`;
export const JWT_SECRET = process.env.MOCK_JWT_SECRET ?? 'bandada-mock-secret-not-for-production';
export const ACCESS_TTL = 900; // 15 min
export const REFRESH_TTL = 30 * 24 * 3600;
export const VERIFY_CODE = '123456';
export const DEMO_PASSWORD = 'Bandada#2026';
export const SAGA_STEP_MS = Number(process.env.MOCK_SAGA_STEP_MS ?? 500); // 3 pasos = 1.5 s
export const QUEUE_TICK_MS = Number(process.env.MOCK_QUEUE_TICK_MS ?? 20000);
export const CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4201',
  'http://localhost:8081',
  'http://app.bandada.localhost',
  'http://admin.bandada.localhost',
  'http://mfe.bandada.localhost',
];
