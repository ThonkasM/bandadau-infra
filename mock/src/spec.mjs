// Carga los OpenAPI públicos de bandadau-docs, los "deref" y compila validadores ajv.
// Las rutas, la seguridad y la exigencia de Idempotency-Key salen del contrato (contract-first).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_DIR = process.env.CONTRACTS_DIR ?? resolve(here, '../../../bandadau-docs/contracts');
export const OPENAPI_DIR = resolve(CONTRACTS_DIR, 'openapi');
export const SDL_PATH = resolve(CONTRACTS_DIR, 'graphql/admin.graphql');
export const SERVICES = ['identity', 'social', 'media', 'events', 'wallet', 'ticketing', 'notification'];

export const contractsAvailable = () => existsSync(OPENAPI_DIR) && existsSync(SDL_PATH);

const docs = new Map();
const loadDoc = (file) => {
  if (!docs.has(file)) docs.set(file, parse(readFileSync(resolve(OPENAPI_DIR, file), 'utf8')));
  return docs.get(file);
};
const pointer = (doc, frag) =>
  frag.replace(/^#?\/?/, '').split('/').filter(Boolean).reduce((n, k) => n?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], doc);

/** Sustituye recursivamente los $ref (de este archivo o de shared/) por su contenido. */
export function deref(node, file, stack = []) {
  if (Array.isArray(node)) return node.map((n) => deref(n, file, stack));
  if (!node || typeof node !== 'object') return node;
  if (node.$ref) {
    const [f, frag] = node.$ref.split('#');
    const targetFile = f ? resolve(dirname(resolve(OPENAPI_DIR, file)), f).replace(OPENAPI_DIR + '/', '') : file;
    const key = `${targetFile}#${frag}`;
    if (stack.includes(key)) return {}; // ciclo: se relaja
    return deref(pointer(loadDoc(targetFile), frag), targetFile, [...stack, key]);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, file, stack);
  return out;
}

export function createAjv() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const f of ['int32', 'int64', 'float', 'double', 'binary', 'byte', 'password']) ajv.addFormat(f, true);
  return ajv;
}
export const ajv = createAjv();
const cache = new Map();
export const compile = (schema, key) => {
  if (key && cache.has(key)) return cache.get(key);
  const fn = ajv.compile(schema);
  if (key) cache.set(key, fn);
  return fn;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
export function loadOperations() {
  const ops = [];
  for (const svc of SERVICES) {
    const file = `${svc}-service.yaml`;
    const doc = loadDoc(file);
    for (const [path, item] of Object.entries(doc.paths)) {
      if (path.startsWith('/internal')) continue;
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
        const idemRequired = params.some((p) => p.$ref?.endsWith('parameters/IdempotencyKey'));
        const rawSecurity = op.security ?? doc.security;
        const security = rawSecurity && rawSecurity.length === 0 ? 'public' : rawSecurity?.some((s) => Object.keys(s).length === 0) ? 'optional' : 'bearer';
        const bodyContent = op.requestBody?.content?.['application/json'];
        const successCode = Object.keys(op.responses).filter((c) => /^2/.test(c)).sort()[0];
        ops.push({
          id: op.operationId, svc, file, method: method.toUpperCase(), path, url: '/api/v1' + path.replace(/\{(\w+)\}/g, ':$1'),
          security, idemRequired, bodyRequired: !!op.requestBody?.required,
          bodySchema: () => (bodyContent ? deref(bodyContent.schema, file) : null),
          successStatus: successCode ? Number(successCode) : 200,
          responseSchema: (code) => {
            const r = op.responses[code];
            const ct = r && deref(r, file)?.content;
            const s = ct?.['application/json']?.schema ?? ct?.['application/problem+json']?.schema;
            return s ? deref(s, file) : null;
          },
          responseCodes: Object.keys(op.responses),
          queryParams: params.map((p) => deref(p, file)).filter((p) => p.in === 'query'),
        });
      }
    }
  }
  return ops;
}
