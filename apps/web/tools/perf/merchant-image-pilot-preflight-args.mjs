// Preflight CLI parsing: space-separated flags plus the merchant-to-slug
// map for the served gate.
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { UUID } from './merchant-image-pilot-preflight-shared.mjs';

// Every documented preflight flag: a typoed key must abort, never degrade
// the gate silently (e.g. --orgin would null the origin and skip every
// served check behind an offline-only ok:true).
const PREFLIGHT_FLAGS = new Set([
  'acceptances',
  'expect-sample',
  'input-root',
  'inventory',
  'origin',
  'output-root',
  'public-dir',
  'recipe',
  'store-map',
  'timeout-ms',
  'write-mounts',
]);

export function parsePreflightArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) {
      throw new Error(`unexpected argument "${flag}"`);
    }
    const key = flag.slice(2);
    if (!PREFLIGHT_FLAGS.has(key)) {
      throw new Error(`unknown preflight flag "${flag}"`);
    }
    if (options[key] !== undefined) {
      throw new Error(`duplicate preflight flag "${flag}"`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag "${flag}" requires a value`);
    }
    index += 1;
    options[key] = value;
  }
  const required = [
    'inventory',
    'acceptances',
    'input-root',
    'output-root',
    'public-dir',
  ];
  for (const key of required) {
    if (!options[key]) {
      throw new Error(`missing required flag --${key}`);
    }
  }
  let timeoutMs = 10_000;
  if (options['timeout-ms'] !== undefined) {
    const parsed = Number(options['timeout-ms']);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('flag "--timeout-ms" needs a positive integer');
    }
    timeoutMs = parsed;
  }
  return {
    acceptances: options.acceptances,
    expectSample: options['expect-sample'] ?? null,
    inputRoot: options['input-root'],
    inventory: options.inventory,
    origin: options.origin ?? null,
    outputRoot: options['output-root'],
    publicDir: options['public-dir'],
    recipe: options.recipe ?? RECIPE_ID,
    storeMap: options['store-map'] ?? null,
    timeoutMs,
    writeMounts: options['write-mounts'] ?? null,
  };
}

// Merchant-to-store-slug map for the served gate (--store-map
// "merchantId=slug,..."). Every inventory merchant must map to the slug of
// its per-store lab page; unmapped merchants fail closed (their mounts
// would otherwise escape the served gate), and wrong slugs fail at the
// reachable/mount gates (404 or foreign bindings).
export function parseStoreMap(value) {
  const map = {};
  if (value == null || String(value).trim() === '') {
    return map;
  }
  for (const entry of String(value).split(',')) {
    const equals = entry.indexOf('=');
    if (equals < 0) {
      throw new Error(`store-map entry "${entry}" is not merchantId=slug`);
    }
    const merchantId = entry.slice(0, equals).trim();
    const slug = entry.slice(equals + 1).trim();
    if (!UUID.test(merchantId)) {
      throw new Error(`store-map merchant "${merchantId}" is not a UUID`);
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
      throw new Error(`store-map slug "${slug}" is not a URL-safe slug`);
    }
    map[merchantId] = slug;
  }
  return map;
}
