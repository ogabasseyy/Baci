import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { MAX_JOBS, PILOT_SCHEMA_VERSION, ROLES } from './constants.mjs';

export class PilotInventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotInventoryError';
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const ENCODED_SEPARATOR_PATTERN = /%(2f|5c|00)/i;

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function isConfinedRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
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
  // Every segment must be a plain name: no empty, '.' or '..' segments.
  const segments = value.split('/');
  return segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..'
  );
}

export const PilotJobSchema = z
  .object({
    assetId: z.string().regex(ASSET_ID_PATTERN),
    expectedSha256: z.string().regex(SHA256_PATTERN),
    merchantId: z.string().uuid(),
    role: z.enum(ROLES),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    sourcePath: z.string().refine(isConfinedRelativePath),
  })
  .strict();

export function parsePilotJob(value) {
  const parsed = PilotJobSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'job'}: ${issue.message}`
      ),
      ok: false,
    };
  }
  return { job: parsed.data, ok: true };
}

export function pilotJobKey(job) {
  return `${job.merchantId}/${job.assetId}/${job.role}`;
}

function sameJobFields(left, right) {
  return (
    left.expectedSha256 === right.expectedSha256 &&
    left.sourcePath === right.sourcePath &&
    left.schemaVersion === right.schemaVersion
  );
}

export function validateInventory(value) {
  if (!Array.isArray(value)) {
    return { errors: ['inventory: expected an array of jobs'], ok: false };
  }
  if (value.length > MAX_JOBS) {
    return {
      errors: [
        `inventory: at most ${MAX_JOBS} jobs, received ${value.length}`,
      ],
      ok: false,
    };
  }
  const jobs = [];
  const errors = [];
  const seen = new Map();
  value.forEach((entry, index) => {
    const parsed = parsePilotJob(entry);
    if (!parsed.ok) {
      errors.push(`job ${index}: ${parsed.issues.join('; ')}`);
      return;
    }
    const job = parsed.job;
    const key = pilotJobKey(job);
    const prior = seen.get(key);
    if (prior) {
      errors.push(
        sameJobFields(prior.job, job)
          ? `job ${index}: duplicate job key "${key}" (also at index ${prior.index})`
          : `job ${index}: conflicting job key "${key}" (also at index ${prior.index})`
      );
      return;
    }
    seen.set(key, { index, job });
    jobs.push(job);
  });
  if (errors.length > 0) {
    return { errors, ok: false };
  }
  return { jobs, ok: true };
}

// Route-parity uniqueness over raw inventory records: the route's
// parsePilotInventory rejects duplicate merchantId/slot and
// merchantId/assetId pairs, so acquisition and generation must refuse them
// before any work proceeds (job keys alone cannot see slot collisions).
export function validateInventoryUniqueness(records) {
  const errors = [];
  const seenSlots = new Set();
  const seenAssets = new Set();
  records.forEach((entry, index) => {
    // Slot keys only exist for records carrying a non-empty slot: two
    // slot-less records must never collide as "merchant/undefined".
    // Asset uniqueness still applies to every record.
    const slot = entry?.slot;
    if (typeof slot === 'string' && slot.length > 0) {
      const slotKey = `${entry?.merchantId}/${slot}`;
      if (seenSlots.has(slotKey)) {
        errors.push(`record ${index}: duplicate slot "${slotKey}"`);
        return;
      }
      seenSlots.add(slotKey);
    }
    const assetKey = `${entry?.merchantId}/${entry?.assetId}`;
    if (seenAssets.has(assetKey)) {
      errors.push(`record ${index}: duplicate asset "${assetKey}"`);
      return;
    }
    seenAssets.add(assetKey);
  });
  if (errors.length > 0) {
    return { errors, ok: false };
  }
  return { errors, ok: true };
}

export async function readInventoryJobs(inventoryPath) {
  const text = await readFile(inventoryPath, 'utf8').catch(() => {
    throw new PilotInventoryError('cannot read inventory file');
  });
  let records;
  try {
    records = JSON.parse(text);
  } catch {
    throw new PilotInventoryError('inventory is not valid JSON');
  }
  if (!Array.isArray(records)) {
    throw new PilotInventoryError('inventory is not an array');
  }
  const validated = validateInventory(
    records.map((entry) => ({
      assetId: entry?.assetId,
      expectedSha256: entry?.sha256 ?? entry?.expectedSha256,
      merchantId: entry?.merchantId,
      role: entry?.role,
      schemaVersion: entry?.schemaVersion,
      sourcePath: entry?.sourcePath,
    }))
  );
  if (!validated.ok) {
    throw new PilotInventoryError(validated.errors.join('; '));
  }
  const unique = validateInventoryUniqueness(records);
  if (!unique.ok) {
    throw new PilotInventoryError(unique.errors.join('; '));
  }
  return validated.jobs;
}
