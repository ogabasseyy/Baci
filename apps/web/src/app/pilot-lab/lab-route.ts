import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadLabConfig,
  type PilotLabConfig,
} from '@/lib/merchant-image-variant-pilot/lab-config';

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

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  return !value
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

const LAB_LOOPBACK_ORIGIN = 'http://localhost:3000';

// Request origin for the card path's absolute staged URLs. Forwarded headers
// are untrusted: only the first proto token survives (http/https, else http),
// and the host is normalized through URL so paths, userinfo, casing, and
// malformed values cannot reach the rendered image URLs.
export function labRequestOrigin(headers: {
  host: string | null;
  proto: string | null;
}): string {
  const first = (headers.proto ?? '').split(',')[0]?.trim().toLowerCase();
  const scheme = first === 'http' || first === 'https' ? first : 'http';
  const host = (headers.host ?? '').trim();
  if (!host) {
    return LAB_LOOPBACK_ORIGIN;
  }
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return LAB_LOOPBACK_ORIGIN;
  }
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
  return value;
}

let cachedConfig: { config: PilotLabConfig; key: string } | null = null;
let inflightLoad: { key: string; promise: Promise<PilotLabConfig> } | null =
  null;

function loadLabConfigFromText(input: {
  acceptancesText: string;
  inputRoot: string;
  inventoryText: string;
  outputRoot: string;
  publicDir: string;
}): Promise<PilotLabConfig> {
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
  return loadLabConfig({
    acceptances: parseRawAcceptances(acceptances),
    inputRoot: input.inputRoot,
    inventoryRecords: parseRawInventoryRecords(inventoryRecords),
    outputRoot: input.outputRoot,
    publicDir: input.publicDir,
  });
}

export async function getLabConfig(): Promise<PilotLabConfig> {
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
  // state. Concurrent first requests share one in-flight load; a failed
  // load clears so the next request retries.
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
    return cachedConfig.config;
  }
  if (inflightLoad?.key === key) {
    return inflightLoad.promise;
  }
  const promise = loadLabConfigFromText({
    acceptancesText,
    inputRoot,
    inventoryText,
    outputRoot,
    publicDir,
  }).then(
    (config) => {
      cachedConfig = { config, key };
      if (inflightLoad?.key === key) {
        inflightLoad = null;
      }
      return config;
    },
    (error: unknown) => {
      if (inflightLoad?.key === key) {
        inflightLoad = null;
      }
      throw error;
    }
  );
  inflightLoad = { key, promise };
  return promise;
}
