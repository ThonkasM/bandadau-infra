import { buildApp } from './app.mjs';
import { contractsAvailable, CONTRACTS_DIR } from './spec.mjs';
import { HOST, PORT } from './config.mjs';

if (!contractsAvailable()) {
  console.error(`[mock] No encuentro los contratos en ${CONTRACTS_DIR}. Define CONTRACTS_DIR o clona bandadau-docs junto a bandadau-infra.`);
  process.exit(1);
}

const app = await buildApp({ logger: process.env.MOCK_LOG ? { level: 'info' } : false });
if (app.missingHandlers.length) console.warn('[mock] operaciones sin handler:', app.missingHandlers.join(', '));
await app.listen({ port: PORT, host: HOST });
console.log(`[mock] Bandada U gateway mock listo en http://localhost:${PORT}`);
console.log(`[mock]   REST  /api/v1 (${app.mockOps.length} operaciones del contrato)   GraphQL  /graphql (HTTP + ws)`);
console.log('[mock]   usuarios: admin|mod|org|lucia|marco @umsa.edu.bo   contraseña: Bandada#2026   código de verificación: 123456');

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().finally(() => process.exit(0)));
