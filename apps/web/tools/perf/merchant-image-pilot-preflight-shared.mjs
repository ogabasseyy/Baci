// Shared preflight primitives: route-mirror patterns, check recording, and
// small predicates. Every preflight module builds on these; nothing here
// knows about inventories, manifests, or served pages.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const HEX64 = /^[0-9a-f]{64}$/;
export const ASSET_ID = /^[A-Za-z0-9._-]{1,128}$/;
// Mirror of the route's z.uuid() (zod v4, verified empirically): version
// nibble 1-8 plus RFC variant nibble, with the nil and max UUIDs excepted.
// A shape-only pattern would pass merchants the route rejects (offline
// green, route 500). Shared by the inventory, acceptance, manifest, and
// store-map mirrors — all four route contracts use z.uuid().
export const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
// Mirror of z.iso.datetime({ offset: true }) (verified empirically):
// calendar date + T + minutes with optional seconds/fraction, then Z or a
// colon offset. Naive, date-only, space-separated, and basic-offset forms
// are all rejected by the route. Shared by the acceptance reviewedAt and
// manifest createdAt mirrors — both route schemas use the same rule.
export const ACCEPTANCE_DATETIME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

// Shape plus real-calendar validity (Feb 30 is out, leap Feb 29 is in),
// matching the route's rejection set on both datetime fields. Date.parse
// alone is insufficient: it rolls impossible dates over (Feb 30 -> Mar 2)
// instead of NaN, so the calendar components must round-trip.
export function isRouteDatetime(value) {
  if (typeof value !== 'string' || !ACCEPTANCE_DATETIME.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('T')[0].split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}
// The route's acceptance schema is .strict(): exactly these keys.
export const ACCEPTANCE_KEYS = new Set([
  'assetId',
  'generationId',
  'merchantId',
  'note',
  'outputHashes',
  'recipeId',
  'reviewedAt',
  'reviewer',
  'schemaVersion',
  'sourceSha256',
  'verdict',
]);
export const TIER_FILE = /^([0-9a-f]{64})\.(avif|webp)$/;
export const ROLES = new Set(['hero', 'logo', 'product']);
export const QUALITIES = new Set([70, 65, 60, 55]);
export const DELIVERIES = new Set([
  'generated',
  'original-passthrough',
  'generated-over-source',
]);
export const FORMATS = new Set(['avif', 'webp']);
export const MANIFEST_KEYS = new Set([
  'assetId',
  'createdAt',
  'encoder',
  'merchantId',
  'policyVersion',
  'recipeId',
  'role',
  'schemaVersion',
  'source',
  'tiers',
]);
export const ENCODER_KEYS = new Set(['libvipsVersion', 'name', 'sharpVersion']);
export const SOURCE_KEYS = new Set([
  'bytes',
  'format',
  'orientedHeight',
  'orientedWidth',
  'sha256',
]);
export const TIER_KEYS = new Set([
  'actualWidth',
  'bytes',
  'contentType',
  'delivery',
  'format',
  'height',
  'path',
  'quality',
  'requestedWidth',
  'sha256',
  'width',
]);

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fail(checks, failures, name, detail) {
  checks.push({ detail, name, ok: false });
  failures.push(`${name}: ${detail}`);
}

export function pass(checks, name) {
  checks.push({ name, ok: true });
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function isIntIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Positional binding, mirroring matchAcceptance/matchPilotAcceptance:
// outputHashes lists tier sha256 in canonical manifest tier order, so
// each accepted hash pins one rung's format, width, and bytes. No
// dedupe, no sort — a sorted-set comparison would let swapped tier
// claims pass offline while the runtime matcher rejects them.
export function positionalHashesMatch(manifestHashes, recordHashes) {
  const record = recordHashes ?? [];
  return (
    manifestHashes.length === record.length &&
    manifestHashes.every((hash, index) => hash === record[index])
  );
}
