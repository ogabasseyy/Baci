import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isPilotLabEnabled,
  loadLabConfig,
  type PilotLabConfig,
} from '@/lib/merchant-image-variant-pilot/lab-config';
import { verifyStagedBytes } from './lab-staged-verify';

// Shared loader for the lab-only pilot routes (gallery + per-store pages).
// Reads the operator's gitignored inventory/acceptances, validates the raw
// records with lab input-validation errors (never incidental TypeErrors),
// then delegates to the verified lab-config builder. Cached per frozen
// input content with in-flight dedupe, like the gallery route documents.

export interface RawInventoryRecord {
  assetId: string;
  merchantId: string;
  role: string;
  sha256: string;
  slot: string;
  sourcePath: string;
  url: string;
}

const RECORD_STRING_FIELDS = [
  'assetId',
  'merchantId',
  'role',
  'sha256',
  'slot',
  'sourcePath',
  'url',
] as const;

// Mirrors the transformer-side isConfinedRelativePath (job-schema.mjs):
// length cap, no control characters, no encoded separators, no
// absolute/empty/dot segments. Traversal is also blocked downstream by
// readVerifiedSnapshot's realpath confinement; this is the fail-fast
// input-validation layer with lab errors instead of incidental throws.
const ENCODED_SEPARATOR_PATTERN = /%(2f|5c|00)/i;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function isSafeRelativePath(value: string): boolean {
  if (value.length < 1 || value.length > 256) {
    return false;
  }
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    hasControlCharacter(value) ||
    ENCODED_SEPARATOR_PATTERN.test(value)
  ) {
    return false;
  }
  return !value
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

export function parseRawInventoryRecords(value: unknown): RawInventoryRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('merchant image pilot: inventory.json must be an array');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(
        `merchant image pilot: inventory[${index}] is not a record`
      );
    }
    const record = entry as Record<string, unknown>;
    for (const field of RECORD_STRING_FIELDS) {
      if (
        typeof record[field] !== 'string' ||
        (record[field] as string).length === 0
      ) {
        throw new Error(
          `merchant image pilot: inventory[${index}].${field} must be a nonempty string`
        );
      }
    }
    if (!isSafeRelativePath(record.sourcePath as string)) {
      throw new Error(
        `merchant image pilot: inventory[${index}].sourcePath must be a safe relative path`
      );
    }
    return {
      assetId: record.assetId as string,
      merchantId: record.merchantId as string,
      role: record.role as string,
      sha256: record.sha256 as string,
      slot: record.slot as string,
      sourcePath: record.sourcePath as string,
      url: record.url as string,
    };
  });
}

export function parseRawAcceptances(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('merchant image pilot: acceptances.json must be an array');
  }
  // Elements stay unknown (the lab-index schema validates their shape),
  // but non-objects fail here with an input-validation error instead of
  // an incidental TypeError deeper in the loader.
  for (const [index, element] of value.entries()) {
    if (
      typeof element !== 'object' ||
      element === null ||
      Array.isArray(element)
    ) {
      throw new Error(
        `merchant image pilot: acceptances[${index}] must be an object`
      );
    }
  }
  return value;
}

let cachedConfig: { config: PilotLabConfig; key: string } | null = null;
const inflightLoads = new Map<string, Promise<PilotLabConfig>>();

function loadLabConfigFromText(
  input: {
    acceptancesText: string;
    inputRoot: string;
    inventoryText: string;
    outputRoot: string;
    publicDir: string;
  },
  options?: { stage?: boolean }
): Promise<PilotLabConfig> {
  let inventoryRecords: unknown;
  let acceptances: unknown;
  try {
    inventoryRecords = JSON.parse(input.inventoryText);
  } catch {
    throw new Error('merchant image pilot: inventory.json is not valid JSON');
  }
  try {
    acceptances = JSON.parse(input.acceptancesText);
  } catch {
    throw new Error('merchant image pilot: acceptances.json is not valid JSON');
  }
  // Read-only by default: staging runs exclusively in the pre-start CLI,
  // so request rendering never writes to disk. Staged bytes are verified
  // by the caller (getLabConfig fails closed when they drift or vanish).
  return loadLabConfig(
    {
      acceptances: parseRawAcceptances(acceptances),
      inputRoot: input.inputRoot,
      inventoryRecords: parseRawInventoryRecords(inventoryRecords),
      outputRoot: input.outputRoot,
      publicDir: input.publicDir,
    },
    { stage: options?.stage ?? false }
  );
}

// Pre-start staging entry for the pilot:stage CLI. Uses the exact same
// validated loader as the routes, but WITH writes enabled — the only
// sanctioned writer of public/__pilot bytes.
export function stageLabConfigFromText(input: {
  acceptancesText: string;
  inputRoot: string;
  inventoryText: string;
  outputRoot: string;
  publicDir: string;
}): Promise<PilotLabConfig> {
  return loadLabConfigFromText(input, { stage: true });
}

export async function getLabConfig(): Promise<PilotLabConfig> {
  // Fail fast before any disk I/O: every caller gates on the flag today,
  // but a future caller of this shared loader must not read operator
  // roots with lab mode off.
  if (!isPilotLabEnabled()) {
    throw new Error('merchant image pilot: refusing to load outside lab mode');
  }
  const inputRoot = process.env.BACI_IMAGE_PILOT_INPUT_ROOT;
  const outputRoot = process.env.BACI_IMAGE_PILOT_OUTPUT_ROOT;
  if (!inputRoot || !outputRoot) {
    throw new Error(
      'merchant image pilot: set BACI_IMAGE_PILOT_INPUT_ROOT and BACI_IMAGE_PILOT_OUTPUT_ROOT to serve the lab routes'
    );
  }
  const publicDir =
    process.env.BACI_IMAGE_PILOT_PUBLIC_DIR ?? join(process.cwd(), 'public');
  // The cache key commits to the frozen input bytes, so an inventory or
  // acceptance edit invalidates the config instead of serving stale lab
  // state. Concurrent first requests share one in-flight load per key;
  // a failed load clears so the next request retries.
  const inventoryText = await readFile(
    join(inputRoot, 'inventory.json'),
    'utf8'
  );
  const acceptancesText = await readFile(
    join(outputRoot, 'acceptances.json'),
    'utf8'
  );
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        acceptancesText,
        inputRoot,
        inventoryText,
        outputRoot,
        publicDir,
      })
    )
    .digest('hex');
  if (cachedConfig?.key === key) {
    // The cache key commits to input bytes, not staged bytes: deleted,
    // never-staged, or drifted public/__pilot files would otherwise keep
    // serving bad URLs. Fail closed with the operator fix instead.
    await verifyStagedBytes(cachedConfig.config.stagedPaths);
    return cachedConfig.config;
  }
  const inflight = inflightLoads.get(key);
  if (inflight) {
    return inflight;
  }
  const promise = loadLabConfigFromText({
    acceptancesText,
    inputRoot,
    inventoryText,
    outputRoot,
    publicDir,
  }).then(
    async (config) => {
      // Fresh loads verify too: the loader is read-only, so missing or
      // drifted staged bytes (forgotten pre-start stage) fail here with
      // the operator fix instead of rendering broken images. The finally
      // clears poisoned in-flight loads: a verify throw must not pin the
      // rejected promise, or every later request with the same key would
      // replay the stale failure instead of retrying.
      try {
        await verifyStagedBytes(config.stagedPaths);
        cachedConfig = { config, key };
        return config;
      } finally {
        if (inflightLoads.get(key) === promise) {
          inflightLoads.delete(key);
        }
      }
    },
    (error: unknown) => {
      if (inflightLoads.get(key) === promise) {
        inflightLoads.delete(key);
      }
      throw error;
    }
  );
  inflightLoads.set(key, promise);
  return promise;
}
