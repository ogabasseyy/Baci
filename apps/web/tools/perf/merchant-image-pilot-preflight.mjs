// Lab launcher/preflight for the merchant image pilot.
//
// Offline gate: validates the inventory, acceptance records, committed
// manifests, output hashes, decoded dimensions, and staged lab bytes before
// any browser comparison runs. Served gate (--origin): fetches the gallery
// and every per-store lab page in both arms and proves every intended
// accepted binding has an actual mount of the expected kind/identity,
// every hero hint owner agrees with its own section's rendered picture,
// width descriptors match actual decoded bytes, and the control arm serves
// originals only. Reported not-optimized rows are audited but excluded
// from optimized coverage.
//
// Usage:
//   node merchant-image-pilot-preflight.mjs --inventory <path> \
//     --acceptances <path> --input-root <dir> --output-root <dir> \
//     --public-dir <dir> [--recipe <recipe-id>] [--origin <url> \
//     --store-map <merchantId=slug,...>]
//
// The recipe and role ladders are pinned to the generator constants (the
// same values the lab route enforces): --recipe only declares the operator's
// expectation and fails closed when it differs from the pin. Exit 0 with a
// JSON report on stdout when every check passes; exit 1 with the failures
// listed otherwise. Local files only; the only network call is the
// operator-supplied lab origin for the served gate.
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  MAX_JOBS,
  RECIPE_ID,
  TIERS,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { selectedCardSubtree } from './merchant-image-pilot-selected-card.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const ASSET_ID = /^[A-Za-z0-9._-]{1,128}$/;
// Mirror of the route's z.uuid() (zod v4, verified empirically): version
// nibble 1-8 plus RFC variant nibble, with the nil and max UUIDs excepted.
// A shape-only pattern would pass merchants the route rejects (offline
// green, route 500). Shared by the inventory, acceptance, manifest, and
// store-map mirrors — all four route contracts use z.uuid().
const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
// Mirror of z.iso.datetime({ offset: true }) (verified empirically):
// calendar date + T + minutes with optional seconds/fraction, then Z or a
// colon offset. Naive, date-only, space-separated, and basic-offset forms
// are all rejected by the route. Shared by the acceptance reviewedAt and
// manifest createdAt mirrors — both route schemas use the same rule.
const ACCEPTANCE_DATETIME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

// Shape plus real-calendar validity (Feb 30 is out, leap Feb 29 is in),
// matching the route's rejection set on both datetime fields. Date.parse
// alone is insufficient: it rolls impossible dates over (Feb 30 -> Mar 2)
// instead of NaN, so the calendar components must round-trip.
function isRouteDatetime(value) {
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
const ACCEPTANCE_KEYS = new Set([
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
const TIER_FILE = /^([0-9a-f]{64})\.(avif|webp)$/;
const ROLES = new Set(['hero', 'logo', 'product']);

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(checks, failures, name, detail) {
  checks.push({ detail, name, ok: false });
  failures.push(`${name}: ${detail}`);
}

function pass(checks, name) {
  checks.push({ name, ok: true });
}

export function parsePreflightArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) {
      throw new Error(`unexpected argument "${flag}"`);
    }
    const key = flag.slice(2);
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
    inputRoot: options['input-root'],
    inventory: options.inventory,
    origin: options.origin ?? null,
    outputRoot: options['output-root'],
    publicDir: options['public-dir'],
    recipe: options.recipe ?? RECIPE_ID,
    storeMap: options['store-map'] ?? null,
    timeoutMs,
  };
}

function acceptanceKey(record) {
  return `${record.merchantId}/${record.assetId}`;
}

function sameAcceptance(left, right) {
  return (
    left.generationId === right.generationId &&
    left.verdict === right.verdict &&
    left.recipeId === right.recipeId &&
    left.sourceSha256 === right.sourceSha256 &&
    [...left.outputHashes].sort().join(',') ===
      [...right.outputHashes].sort().join(',')
  );
}

// Mirror of lab-config originalFileName: the staged original name is derived
// from the binding plus the source-path extension, never from remote input.
function stagedOriginalName(binding, sourcePath) {
  const segments = String(sourcePath).split('/');
  const base = segments[segments.length - 1] ?? '';
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  const safeExtension = /^\.[a-z0-9]{1,5}$/i.test(extension)
    ? extension.toLowerCase()
    : '';
  return `${binding.merchantId}-${binding.assetId}${safeExtension}`;
}

// Mirror of the route's binding contract (parsePilotInventoryBinding):
// assetId charset, http(s) source URL. Record-shape fields (slot,
// sourcePath, sha256) keep the standalone record checks.
function validInventoryRecord(record) {
  return (
    record &&
    typeof record === 'object' &&
    UUID.test(record.merchantId ?? '') &&
    ASSET_ID.test(record.assetId ?? '') &&
    ROLES.has(record.role) &&
    typeof record.slot === 'string' &&
    record.slot.length > 0 &&
    record.slot.length <= 128 &&
    HEX64.test(record.sha256 ?? '') &&
    isSafeRelativePath(record.sourcePath) &&
    isHttpUrl(record.url)
  );
}

// Exact mirror of lab-route isSafeRelativePath: non-empty relative path,
// no backslashes, no empty/dot/dot-dot segments. Offline must never report
// ok for an inventory the route rejects.
function isSafeRelativePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\')
  ) {
    return false;
  }
  return !value
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isHttpUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validAcceptanceShape(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  const keys = Object.keys(record);
  if (
    keys.length !== ACCEPTANCE_KEYS.size ||
    keys.some((key) => !ACCEPTANCE_KEYS.has(key))
  ) {
    return false;
  }
  const text = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  return (
    UUID.test(record.merchantId ?? '') &&
    text(record.assetId, 128) &&
    HEX64.test(record.generationId ?? '') &&
    text(record.recipeId, 64) &&
    (record.verdict === 'accepted' || record.verdict === 'rejected') &&
    HEX64.test(record.sourceSha256 ?? '') &&
    Array.isArray(record.outputHashes) &&
    record.outputHashes.length > 0 &&
    record.outputHashes.length <= 24 &&
    record.outputHashes.every((hash) => HEX64.test(hash ?? '')) &&
    text(record.note, 500) &&
    text(record.reviewer, 128) &&
    isRouteDatetime(record.reviewedAt) &&
    record.schemaVersion === 1
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const QUALITIES = new Set([70, 65, 60, 55]);
const DELIVERIES = new Set([
  'generated',
  'original-passthrough',
  'generated-over-source',
]);
const FORMATS = new Set(['avif', 'webp']);
const MANIFEST_KEYS = new Set([
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
const ENCODER_KEYS = new Set(['libvipsVersion', 'name', 'sharpVersion']);
const SOURCE_KEYS = new Set([
  'bytes',
  'format',
  'orientedHeight',
  'orientedWidth',
  'sha256',
]);
const TIER_KEYS = new Set([
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

function isIntIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Standalone mirror of the route's manifest schema (zod in
// schemas/merchant-image-variant-pilot.ts, reference in
// pilot/manifest.mjs). Every rule is cross-checked by the shared
// contract-fixtures corpus consumed by all three suites, so drift breaks
// loudly. Returns the issue list (empty = valid).
export function assertManifestContract(manifest, { recipeId, role }) {
  const issues = [];
  if (!isPlainObject(manifest)) {
    return ['manifest is not an object'];
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) {
      issues.push(`unexpected manifest field "${key}"`);
    }
  }
  if (
    typeof manifest.assetId !== 'string' ||
    manifest.assetId.length < 1 ||
    manifest.assetId.length > 128
  ) {
    issues.push('assetId must be 1..128 chars');
  }
  if (!isRouteDatetime(manifest.createdAt)) {
    issues.push('createdAt must be an ISO datetime with offset');
  }
  const encoder = manifest.encoder;
  if (!isPlainObject(encoder)) {
    issues.push('encoder is not an object');
  } else {
    for (const key of Object.keys(encoder)) {
      if (!ENCODER_KEYS.has(key)) {
        issues.push(`unexpected encoder field "${key}"`);
      }
    }
    if (
      typeof encoder.libvipsVersion !== 'string' ||
      encoder.libvipsVersion.length < 1
    ) {
      issues.push('encoder libvipsVersion is required');
    }
    if (encoder.name !== 'sharp') {
      issues.push('encoder name must be "sharp"');
    }
    if (
      typeof encoder.sharpVersion !== 'string' ||
      encoder.sharpVersion.length < 1
    ) {
      issues.push('encoder sharpVersion is required');
    }
  }
  if (!UUID.test(manifest.merchantId ?? '')) {
    issues.push('merchantId must be a UUID');
  }
  if (manifest.policyVersion !== 1) {
    issues.push('policyVersion must be 1');
  }
  if (manifest.schemaVersion !== 1) {
    issues.push('schemaVersion must be 1');
  }
  if (
    typeof manifest.recipeId !== 'string' ||
    manifest.recipeId.length < 1 ||
    manifest.recipeId.length > 64
  ) {
    issues.push('recipeId must be 1..64 chars');
  } else if (manifest.recipeId !== recipeId) {
    issues.push(`recipe "${manifest.recipeId}" is not current ("${recipeId}")`);
  }
  if (manifest.role !== role) {
    issues.push(
      `role "${manifest.role}" does not match binding role "${role}"`
    );
  }
  const source = manifest.source;
  if (!isPlainObject(source)) {
    issues.push('source is not an object');
  } else {
    for (const key of Object.keys(source)) {
      if (!SOURCE_KEYS.has(key)) {
        issues.push(`unexpected source field "${key}"`);
      }
    }
    if (!Number.isInteger(source.bytes) || source.bytes < 1) {
      issues.push('source bytes must be a positive integer');
    }
    if (typeof source.format !== 'string' || source.format.length < 1) {
      issues.push('source format is required');
    }
    if (!isIntIn(source.orientedHeight, 1, 16384)) {
      issues.push('source orientedHeight out of range');
    }
    if (!isIntIn(source.orientedWidth, 1, 16384)) {
      issues.push('source orientedWidth out of range');
    }
    if (!HEX64.test(source.sha256 ?? '')) {
      issues.push('source sha256 must be 64 hex chars');
    }
  }
  const tiers = manifest.tiers;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 24) {
    issues.push('tiers must list 1..24 entries');
    return issues;
  }
  for (const [index, tier] of tiers.entries()) {
    if (!isPlainObject(tier)) {
      issues.push(`tier ${index} is not an object`);
      continue;
    }
    for (const key of Object.keys(tier)) {
      if (!TIER_KEYS.has(key)) {
        issues.push(`tier ${index} has unexpected field "${key}"`);
      }
    }
    if (!isIntIn(tier.actualWidth, 1, 16384)) {
      issues.push(`tier ${index} actualWidth out of range`);
    }
    if (!Number.isInteger(tier.bytes) || tier.bytes < 1) {
      issues.push(`tier ${index} bytes must be a positive integer`);
    }
    if (!FORMATS.has(tier.format)) {
      issues.push(`tier ${index} has unknown format`);
    } else if (tier.contentType !== `image/${tier.format}`) {
      issues.push(`tier ${index} content type must match the format`);
    }
    if (!isIntIn(tier.height, 1, 16384)) {
      issues.push(`tier ${index} height out of range`);
    }
    if (!TIER_FILE.test(tier.path ?? '')) {
      issues.push(`tier ${index} path is not a content-hash file name`);
    } else if (tier.path !== `${tier.sha256}.${tier.format}`) {
      issues.push(`tier ${index} path must bind the output hash and format`);
    }
    if (tier.delivery !== undefined && !DELIVERIES.has(tier.delivery)) {
      issues.push(`tier ${index} delivery "${tier.delivery}" is not allowed`);
    }
    if (tier.delivery === 'original-passthrough' && tier.quality !== null) {
      issues.push(`tier ${index} pass-through carries no encode quality`);
    } else if (
      (tier.delivery === 'generated' ||
        tier.delivery === 'generated-over-source') &&
      tier.quality === null
    ) {
      issues.push(`tier ${index} generated delivery needs encode quality`);
    } else if (
      tier.delivery !== 'original-passthrough' &&
      !QUALITIES.has(tier.quality)
    ) {
      issues.push(
        `tier ${index} quality ${tier.quality} is not an allowed step`
      );
    }
    if (!isIntIn(tier.requestedWidth, 1, 16384)) {
      issues.push(`tier ${index} requestedWidth out of range`);
    }
    if (!HEX64.test(tier.sha256 ?? '')) {
      issues.push(`tier ${index} sha256 must be 64 hex chars`);
    }
    if (!isIntIn(tier.width, 1, 16384)) {
      issues.push(`tier ${index} width out of range`);
    } else if (tier.width !== tier.actualWidth) {
      issues.push(`tier ${index} width must equal the encoded width`);
    }
  }
  const expectedLadder = new Set();
  for (const width of TIERS[role] ?? []) {
    for (const format of ['avif', 'webp']) {
      expectedLadder.add(`${width}:${format}`);
    }
  }
  const seenLadder = new Set();
  let ladderOk = expectedLadder.size > 0;
  for (const tier of tiers) {
    // Non-object entries were already reported above; mark the ladder
    // invalid and stop so the check reports a contract failure instead of
    // throwing on the property reads below.
    if (!isPlainObject(tier)) {
      ladderOk = false;
      break;
    }
    const key = `${tier.requestedWidth}:${tier.format}`;
    if (!expectedLadder.has(key) || seenLadder.has(key)) {
      ladderOk = false;
      break;
    }
    seenLadder.add(key);
  }
  if (!ladderOk || seenLadder.size !== expectedLadder.size) {
    issues.push(`tiers do not cover the ${role} ladder exactly once`);
  }
  // Never-larger invariants hold only where a disposition is recorded;
  // legacy tiers without one are exempt (frozen r1 keeps its meaning).
  if (isPlainObject(source)) {
    for (const tier of tiers) {
      if (!isPlainObject(tier) || tier.delivery === undefined) {
        continue;
      }
      const key = `${tier.requestedWidth}:${tier.format}`;
      if (tier.delivery === 'generated' && tier.bytes > source.bytes) {
        issues.push(
          `tier "${key}" claims generated delivery above the source bytes`
        );
      }
      if (
        tier.delivery === 'generated-over-source' &&
        (tier.bytes <= source.bytes || tier.format === source.format)
      ) {
        issues.push(
          `tier "${key}" claims an over-source limitation that does not hold`
        );
      }
      if (tier.delivery === 'original-passthrough') {
        const matchesSource =
          tier.bytes === source.bytes &&
          tier.sha256 === source.sha256 &&
          tier.width === source.orientedWidth &&
          tier.height === source.orientedHeight &&
          tier.format === source.format;
        if (!matchesSource) {
          issues.push(
            `tier "${key}" pass-through must reuse the validated source bytes, dimensions, and codec`
          );
        }
      }
    }
  }
  return issues;
}

export async function runOfflinePreflight(options) {
  const checks = [];
  const failures = [];
  // Bindings that passed every offline stage (acceptance, manifest
  // contract, tier bytes, staged bytes). The served gate requires an actual
  // mount of the expected kind/identity for exactly these bindings;
  // anything else must render a reporting row and is excluded from
  // optimized coverage by construction.
  const accepted = [];
  const effectiveRecipe = options.recipe ?? RECIPE_ID;
  if (effectiveRecipe !== RECIPE_ID) {
    fail(
      checks,
      failures,
      'recipe-pin',
      `caller recipe "${effectiveRecipe}" does not match the pinned recipe "${RECIPE_ID}"`
    );
    return { accepted, checks, failures, ok: false };
  }
  pass(checks, 'recipe-pin');
  let inventory;
  let acceptances;
  try {
    inventory = await readJson(options.inventory);
  } catch (error) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `cannot read inventory (${error.message})`
    );
    return { accepted, checks, failures, ok: false };
  }
  try {
    acceptances = await readJson(options.acceptances);
  } catch (error) {
    fail(
      checks,
      failures,
      'acceptances-parse',
      `cannot read acceptances (${error.message})`
    );
    return { accepted, checks, failures, ok: false };
  }
  if (!Array.isArray(inventory) || inventory.length === 0) {
    fail(
      checks,
      failures,
      'inventory-parse',
      'inventory must be a non-empty array'
    );
    return { accepted, checks, failures, ok: false };
  }
  if (!Array.isArray(acceptances)) {
    fail(checks, failures, 'acceptances-parse', 'acceptances must be an array');
    return { accepted, checks, failures, ok: false };
  }
  const badInventory = inventory.filter(
    (record) => !validInventoryRecord(record)
  );
  if (badInventory.length > 0) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `${badInventory.length} inventor${badInventory.length === 1 ? 'y record is' : 'y records are'} malformed`
    );
    return { accepted, checks, failures, ok: false };
  }
  // Mirror of parsePilotInventory: size cap plus merchant-scoped slot and
  // asset uniqueness. Offline must never report ok for an inventory the
  // route rejects.
  if (inventory.length > MAX_JOBS) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `inventory holds ${inventory.length} records, at most ${MAX_JOBS} allowed`
    );
    return { accepted, checks, failures, ok: false };
  }
  const seenSlots = new Set();
  const seenAssets = new Set();
  for (const record of inventory) {
    const slotKey = `${record.merchantId}/${record.slot}`;
    const assetKey = `${record.merchantId}/${record.assetId}`;
    if (seenSlots.has(slotKey)) {
      fail(checks, failures, 'inventory-parse', `duplicate slot "${slotKey}"`);
      return { accepted, checks, failures, ok: false };
    }
    if (seenAssets.has(assetKey)) {
      fail(
        checks,
        failures,
        'inventory-parse',
        `duplicate asset "${assetKey}"`
      );
      return { accepted, checks, failures, ok: false };
    }
    seenSlots.add(slotKey);
    seenAssets.add(assetKey);
  }
  pass(checks, 'inventory-parse');

  const malformed = [];
  const byAsset = new Map();
  const conflicting = new Set();
  acceptances.forEach((record, position) => {
    if (!validAcceptanceShape(record)) {
      malformed.push(position);
      return;
    }
    const key = acceptanceKey(record);
    const prior = byAsset.get(key);
    if (!prior) {
      byAsset.set(key, record);
      return;
    }
    if (!sameAcceptance(prior, record)) {
      conflicting.add(key);
    }
  });
  if (malformed.length > 0) {
    fail(
      checks,
      failures,
      'acceptances-parse',
      `malformed acceptance records at index ${malformed.join(', ')}`
    );
  } else {
    pass(checks, 'acceptances-parse');
  }
  if (conflicting.size > 0) {
    fail(
      checks,
      failures,
      'acceptance-duplicates',
      `conflicting duplicates for ${[...conflicting].join(', ')}`
    );
  } else {
    pass(checks, 'acceptance-duplicates');
  }

  for (const record of inventory) {
    const name = `binding:${record.assetId}`;
    // Input snapshot integrity: the frozen input file must exist under the
    // input root and hash to the inventory claim. Without this, a tampered
    // or missing snapshot passes whenever the staged copy still matches.
    const inputRoot = resolve(options.inputRoot);
    // realpath on both sides (mirror of lab-config): lexical containment
    // passes a symlinked dir that resolves outside the root.
    const realRoot = await realpath(inputRoot).catch(() => null);
    const inputPath = resolve(inputRoot, record.sourcePath);
    const realPath = await realpath(inputPath).catch(() => null);
    if (realPath === null) {
      fail(
        checks,
        failures,
        `${name}:input`,
        `input snapshot missing: ${record.sourcePath}`
      );
      continue;
    }
    if (
      realRoot === null ||
      (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`))
    ) {
      fail(
        checks,
        failures,
        `${name}:input`,
        `input escapes the input root: ${record.sourcePath}`
      );
      continue;
    }
    let inputBytes;
    try {
      inputBytes = await readFile(realPath);
    } catch {
      fail(
        checks,
        failures,
        `${name}:input`,
        `input snapshot missing: ${record.sourcePath}`
      );
      continue;
    }
    if (sha256Hex(inputBytes) !== record.sha256) {
      fail(
        checks,
        failures,
        `${name}:input`,
        `input snapshot hash mismatch: ${record.sourcePath}`
      );
      continue;
    }
    pass(checks, `${name}:input`);
    const key = acceptanceKey(record);
    const acceptance = byAsset.get(key);
    if (conflicting.has(key)) {
      fail(
        checks,
        failures,
        `${name}:acceptance`,
        'conflicting duplicate acceptances'
      );
      continue;
    }
    if (!acceptance) {
      fail(
        checks,
        failures,
        `${name}:acceptance`,
        'no acceptance record for this merchant/asset'
      );
      continue;
    }
    if (acceptance.verdict !== 'accepted') {
      fail(
        checks,
        failures,
        `${name}:acceptance`,
        `verdict is "${acceptance.verdict}"`
      );
      continue;
    }
    if (acceptance.recipeId !== effectiveRecipe) {
      fail(
        checks,
        failures,
        `${name}:acceptance`,
        `recipe "${acceptance.recipeId}" is not current ("${effectiveRecipe}")`
      );
      continue;
    }
    if (acceptance.sourceSha256 !== record.sha256) {
      fail(
        checks,
        failures,
        `${name}:acceptance`,
        'acceptance source hash differs from inventory'
      );
      continue;
    }
    pass(checks, `${name}:acceptance`);

    let manifest;
    try {
      manifest = await readJson(
        join(
          options.outputRoot,
          'generations',
          acceptance.generationId,
          'manifest.json'
        )
      );
    } catch {
      fail(
        checks,
        failures,
        `${name}:manifest`,
        'generation manifest is missing or unreadable'
      );
      continue;
    }
    const contractIssues = assertManifestContract(manifest, {
      recipeId: effectiveRecipe,
      role: record.role,
    });
    if (contractIssues.length > 0) {
      fail(
        checks,
        failures,
        `${name}:manifest`,
        `manifest contract invalid (${contractIssues.join('; ')})`
      );
      continue;
    }
    if (
      manifest.merchantId !== record.merchantId ||
      manifest.assetId !== record.assetId ||
      manifest.source.sha256 !== record.sha256
    ) {
      fail(
        checks,
        failures,
        `${name}:manifest`,
        'manifest identity does not match the bound inventory record'
      );
      continue;
    }
    const manifestHashes = [
      ...new Set(manifest.tiers.map((tier) => tier.sha256)),
    ].sort();
    const recordHashes = [...new Set(acceptance.outputHashes)].sort();
    const hashesEqual =
      manifestHashes.length === recordHashes.length &&
      manifestHashes.every((hash, index) => hash === recordHashes[index]);
    if (!hashesEqual) {
      fail(
        checks,
        failures,
        `${name}:manifest`,
        'encoded output bytes changed: acceptance hashes differ from manifest tiers'
      );
      continue;
    }
    pass(checks, `${name}:manifest`);

    let tiersOk = true;
    for (const tier of manifest.tiers) {
      const match = TIER_FILE.exec(tier.path ?? '');
      if (!match || match[1] !== tier.sha256 || match[2] !== tier.format) {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `tier file name "${tier.path}" is not bound to its hash/format`
        );
        tiersOk = false;
        break;
      }
      let bytes;
      try {
        bytes = await readFile(
          join(
            options.outputRoot,
            'generations',
            acceptance.generationId,
            tier.path
          )
        );
      } catch {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `committed output missing: ${tier.path}`
        );
        tiersOk = false;
        break;
      }
      if (bytes.length !== tier.bytes || sha256Hex(bytes) !== tier.sha256) {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `committed output hash mismatch: ${tier.path}`
        );
        tiersOk = false;
        break;
      }
      let meta;
      try {
        meta = await sharp(bytes).metadata();
      } catch {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `committed output does not decode: ${tier.path}`
        );
        tiersOk = false;
        break;
      }
      if (meta.width !== tier.width || meta.height !== tier.height) {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `decoded dimensions ${meta.width}x${meta.height} differ from manifest ${tier.width}x${tier.height}: ${tier.path}`
        );
        tiersOk = false;
        break;
      }
      const containerOk =
        (tier.format === 'webp' && meta.format === 'webp') ||
        (tier.format === 'avif' &&
          meta.format === 'heif' &&
          meta.compression === 'av1');
      if (!containerOk) {
        fail(
          checks,
          failures,
          `${name}:tiers`,
          `decoded container ${meta.format}/${meta.compression ?? 'unknown'} is not ${tier.format}: ${tier.path}`
        );
        tiersOk = false;
        break;
      }
    }
    if (!tiersOk) {
      continue;
    }
    pass(checks, `${name}:tiers`);

    let stagedOk = true;
    for (const tier of manifest.tiers) {
      let staged;
      try {
        staged = await readFile(
          join(options.publicDir, '__pilot', acceptance.generationId, tier.path)
        );
      } catch {
        fail(
          checks,
          failures,
          `${name}:staged`,
          `staged derivative missing: ${tier.path}`
        );
        stagedOk = false;
        break;
      }
      if (staged.length !== tier.bytes || sha256Hex(staged) !== tier.sha256) {
        fail(
          checks,
          failures,
          `${name}:staged`,
          `staged derivative hash mismatch: ${tier.path}`
        );
        stagedOk = false;
        break;
      }
    }
    if (stagedOk) {
      const originalName = stagedOriginalName(
        { assetId: record.assetId, merchantId: record.merchantId },
        record.sourcePath
      );
      let stagedOriginal;
      try {
        stagedOriginal = await readFile(
          join(options.publicDir, '__pilot', 'originals', originalName)
        );
      } catch {
        fail(
          checks,
          failures,
          `${name}:staged`,
          `staged original missing: ${originalName}`
        );
        stagedOk = false;
      }
      if (stagedOk && sha256Hex(stagedOriginal) !== record.sha256) {
        fail(
          checks,
          failures,
          `${name}:staged`,
          `staged original hash mismatch: ${originalName}`
        );
        stagedOk = false;
      }
    }
    if (!stagedOk) {
      continue;
    }
    pass(checks, `${name}:staged`);
    accepted.push({
      assetId: record.assetId,
      binding: acceptanceKey(record),
      generationId: acceptance.generationId,
      merchantId: record.merchantId,
      role: record.role,
      slotId: record.slot,
      stagedOriginal: `/__pilot/originals/${stagedOriginalName(
        { assetId: record.assetId, merchantId: record.merchantId },
        record.sourcePath
      )}`,
    });
  }
  return { accepted, checks, failures, ok: failures.length === 0 };
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

export function extractLabPreloads(html) {
  const links = [];
  for (const match of String(html).matchAll(/<link\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1]);
    if (!('data-pilot-lab-preload' in attrs)) {
      continue;
    }
    links.push({
      arm: attrs['data-pilot-lab-preload'],
      as: attrs.as,
      binding: attrs['data-pilot-lab-binding'],
      fetchPriority: attrs.fetchpriority,
      href: attrs.href,
      imageSizes: attrs.imagesizes,
      imageSrcSet: attrs.imagesrcset,
      media: attrs.media,
      rel: attrs.rel,
      type: attrs.type,
    });
  }
  return links;
}

export function extractLabPictures(html) {
  const pictures = [];
  for (const match of String(html).matchAll(
    /<picture\b([^>]*)>([\s\S]*?)<\/picture>/g
  )) {
    const attrs = parseAttrs(match[1]);
    if (
      !(
        'data-pilot-lab-picture' in attrs ||
        'data-pilot-lab-hero-slide' in attrs ||
        'data-pilot-lab-card-image' in attrs ||
        'data-pilot-lab-header-logo' in attrs
      )
    ) {
      continue;
    }
    const sources = [];
    for (const source of match[2].matchAll(/<source\b([^>]+)>/g)) {
      const sourceAttrs = parseAttrs(source[1]);
      sources.push({
        media: sourceAttrs.media,
        sizes: sourceAttrs.sizes,
        srcSet: sourceAttrs.srcset,
        type: sourceAttrs.type,
      });
    }
    pictures.push({ arm: attrs['data-pilot-lab-picture'] ?? null, sources });
  }
  return pictures;
}

export function extractLabBindings(html) {
  const bindings = [];
  for (const match of String(html).matchAll(
    /data-pilot-lab-binding="([^"]+)"/g
  )) {
    bindings.push(match[1]);
  }
  return bindings;
}

// Binding sections are the unit of served coverage: every intended mount is
// verified inside its own section (kind, identity, and hint pairing), never
// by document order across sections. Reporting rows (not-optimized /
// missing-binding) carry the same markers so they are auditable — and so
// the mount gate can tell "reported" from "mounted".
export function extractLabSections(html) {
  const sections = [];
  for (const match of String(html).matchAll(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/g
  )) {
    const attrs = parseAttrs(match[1]);
    if (
      !(
        'data-pilot-lab-binding' in attrs ||
        attrs['data-pilot-lab-status'] === 'missing-binding'
      )
    ) {
      continue;
    }
    sections.push({
      binding: attrs['data-pilot-lab-binding'] ?? null,
      html: match[2],
      slotId: attrs['data-pilot-lab-slot'] ?? null,
      status: attrs['data-pilot-lab-status'] ?? null,
    });
  }
  return sections;
}

function sectionPictures(sectionHtml) {
  // Every <picture> in the section — lab-marked mounts and original-renderer
  // control mounts (the store control hero has no lab marker by design).
  const pictures = [];
  for (const match of String(sectionHtml).matchAll(
    /<picture\b([^>]*)>([\s\S]*?)<\/picture>/g
  )) {
    const attrs = parseAttrs(match[1]);
    const sources = [];
    for (const source of match[2].matchAll(/<source\b([^>]+)>/g)) {
      const sourceAttrs = parseAttrs(source[1]);
      sources.push({
        media: sourceAttrs.media,
        sizes: sourceAttrs.sizes,
        srcSet: sourceAttrs.srcset,
        type: sourceAttrs.type,
      });
    }
    const img = match[2].match(/<img\b([^>]+)>/);
    pictures.push({
      attrs,
      img: img ? parseAttrs(img[1]) : null,
      sources,
    });
  }
  return pictures;
}

function sectionLinks(sectionHtml, arm) {
  const links = [];
  for (const match of String(sectionHtml).matchAll(/<link\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1]);
    if (attrs['data-pilot-lab-preload'] !== arm) {
      continue;
    }
    links.push({
      as: attrs.as,
      fetchPriority: attrs.fetchpriority,
      href: attrs.href,
      imageSizes: attrs.imagesizes,
      imageSrcSet: attrs.imagesrcset,
      media: attrs.media,
      rel: attrs.rel,
      type: attrs.type,
    });
  }
  return links;
}

function sectionStandaloneImgs(sectionHtml) {
  const stripped = String(sectionHtml).replace(
    /<picture\b[\s\S]*?<\/picture>/g,
    ''
  );
  return [...stripped.matchAll(/<img\b([^>]+)>/g)].map((match) =>
    parseAttrs(match[1])
  );
}

// Mount-kind classification for one section picture. Gallery mounts carry
// data-pilot-lab-picture (hero iff a source has media); store pilot mounts
// carry their slot marker; the store control hero is the unmarked original
// renderer (media source, no lab marker).
function pictureKind(picture) {
  const attrs = picture.attrs;
  if ('data-pilot-lab-hero-slide' in attrs) {
    return 'hero-slide';
  }
  if ('data-pilot-lab-card-image' in attrs) {
    return 'card-image';
  }
  if ('data-pilot-lab-header-logo' in attrs) {
    return 'header-logo';
  }
  if ('data-pilot-lab-picture' in attrs) {
    return picture.sources.some((source) => source.media)
      ? 'gallery-hero'
      : 'gallery-picture';
  }
  if (picture.sources.some((source) => source.media)) {
    return 'original-hero';
  }
  return 'original-picture';
}

function stripQuery(url, origin) {
  return relativizeServedUrl(String(url ?? '').split('?')[0], origin);
}

// Same-origin absolute lab URLs (the store card path serves absolute staged
// URLs because the original card renderer rejects relative ones — see
// lab-store-page.tsx) compare as their path; anything else passes through
// untouched so foreign hosts still fail the lab-prefix gates.
function relativizeServedUrl(url, origin) {
  const value = String(url ?? '');
  const root = String(origin ?? '').replace(/\/$/, '');
  if (
    root &&
    value.startsWith(root) &&
    value.slice(root.length).startsWith('/')
  ) {
    return value.slice(root.length);
  }
  return value;
}

function srcSetHasBase(srcSet, base, origin) {
  return srcSetCandidates(srcSet).some(
    (candidate) => stripQuery(candidate.url, origin) === base
  );
}

function srcSetHasPrefix(srcSet, prefix, origin) {
  return srcSetCandidates(srcSet).some((candidate) =>
    stripQuery(candidate.url, origin).startsWith(prefix)
  );
}

function srcSetCandidates(srcSet) {
  const value = String(srcSet ?? '').trim();
  if (!value) {
    return [];
  }
  const described = [...value.matchAll(/(\S+) (\d+)w/g)].map((match) => ({
    descriptor: Number(match[2]),
    url: match[1],
  }));
  if (described.length > 0) {
    return described;
  }
  return [{ descriptor: null, url: value }];
}

// Hint agreement: every mounted hero section pairs its OWN preload link
// with its OWN rendered picture. React hoists <link rel=preload> to <head>,
// so served sections never contain their link — pairing is by the link's
// data-pilot-lab-binding identity (emitted by PilotLabScannerLink), never by
// subtree position or document order. A link for another binding (or no
// binding at all) never pairs, and a mounted hero without its own link
// fails (no vacuous zero-to-zero pass). The pilot arm gates on image/avif;
// the control arm serves format-agnostic bytes and omits type.
export function assertServedAgreement(html, { arm }) {
  const failures = [];
  const name = `served:${arm}:owner-agreement`;
  // Every bound, unreported section is a pairing candidate — not just the
  // hero slot. The hero-kind picture filter below skips header/card
  // sections, while a hero picture mis-mounted under a foreign slot still
  // has to pair with its own link instead of slipping past the filter.
  const heroSections = extractLabSections(html).filter(
    (section) => section.binding != null && !section.status
  );
  const docLinks = extractLabPreloads(html).filter((link) => link.arm === arm);
  for (const section of heroSections) {
    const pictures = sectionPictures(section.html).filter((picture) =>
      ['hero-slide', 'gallery-hero', 'original-hero'].includes(
        pictureKind(picture)
      )
    );
    if (pictures.length === 0) {
      // No mounted hero picture: mount-coverage owns the absence verdict.
      continue;
    }
    const links = docLinks.filter(
      (link) => link.binding != null && link.binding === section.binding
    );
    if (links.length === 0) {
      failures.push(
        `${name}: mounted hero section ${section.binding} has no preload link`
      );
      continue;
    }
    if (links.length !== pictures.length) {
      failures.push(
        `${name}: section ${section.binding} pairs ${links.length} preload links with ${pictures.length} hero pictures`
      );
      continue;
    }
    links.forEach((link, position) => {
      const picture = pictures[position];
      // The rendered srcSet the hint must match: the AVIF tier when the
      // mount has one (lab mounts), else the media source the original
      // renderer paints (store control hero).
      const rendered =
        picture.sources.find((source) => source.type === 'image/avif') ??
        picture.sources.find((source) => source.media);
      if (link.rel !== 'preload' || link.as !== 'image') {
        failures.push(
          `${name}: section ${section.binding} link ${position} is not rel=preload as=image`
        );
        return;
      }
      if (!rendered) {
        failures.push(
          `${name}: section ${section.binding} picture ${position} has no rendered media source`
        );
        return;
      }
      if (link.imageSrcSet !== rendered.srcSet) {
        failures.push(
          `${name}: section ${section.binding} link ${position} imageSrcSet differs from the rendered source`
        );
      }
      if (link.imageSizes !== rendered.sizes) {
        failures.push(
          `${name}: section ${section.binding} link ${position} imageSizes differs from the rendered source`
        );
      }
      if (link.media !== rendered.media) {
        failures.push(
          `${name}: section ${section.binding} link ${position} media differs from the rendered source`
        );
      }
      if (arm === 'pilot' ? link.type !== 'image/avif' : link.type != null) {
        failures.push(
          `${name}: section ${section.binding} link ${position} has the wrong format gate for the ${arm} arm`
        );
      }
      if (link.fetchPriority !== 'high') {
        failures.push(
          `${name}: section ${section.binding} link ${position} fetchPriority is not high`
        );
      }
      const candidates = srcSetCandidates(link.imageSrcSet).map(
        (entry) => entry.url
      );
      if (!candidates.includes(link.href)) {
        failures.push(
          `${name}: section ${section.binding} link ${position} href is not one of the preloaded candidates`
        );
      }
    });
  }
  return failures;
}

// Intended pass-through serves the verified copy from the binding's own
// generation URL; a staged-original fetch inside pilot scope is an
// accidental double download (or leak), never intended delivery.
function pilotScopeLeaksOriginal(scopeHtml, { arm, origin }) {
  if (arm !== 'pilot') {
    return false;
  }
  return sectionLabUrls(scopeHtml, arm).some((url) => {
    const base = relativizeServedUrl(url, origin).split('?')[0];
    return base.startsWith('/__pilot/originals/');
  });
}

function checkHeroMount(section, mount, { arm, origin }) {
  const problems = [];
  const pictures = sectionPictures(section.html).filter((picture) =>
    ['hero-slide', 'gallery-hero', 'original-hero'].includes(
      pictureKind(picture)
    )
  );
  if (pictures.length === 0) {
    return ['no hero picture mounted'];
  }
  const picture = pictures[0];
  // Gallery mounts carry their arm; store mounts inherit the page arm.
  const marked = picture.attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`hero mount is marked for the ${marked} arm`);
  }
  if (arm === 'pilot') {
    const avif = picture.sources.find((source) => source.type === 'image/avif');
    if (!avif) {
      problems.push('pilot hero mount has no AVIF source');
      return problems;
    }
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot hero AVIF source does not serve this generation');
    }
    const fallback = picture.sources.find((source) => !source.type);
    if (!fallback) {
      problems.push('pilot hero mount has no fallback source');
    } else if (
      !srcSetHasPrefix(
        fallback.srcSet,
        `/__pilot/${mount.generationId}/`,
        origin
      )
    ) {
      problems.push(
        'pilot hero fallback source does not serve this generation'
      );
    }
    if (pilotScopeLeaksOriginal(section.html, { arm, origin })) {
      problems.push(
        'pilot hero mount fetches a staged original instead of the generation copy'
      );
    }
    return problems;
  }
  const rendered =
    picture.sources.find((source) => source.type === 'image/avif') ??
    picture.sources.find((source) => source.media);
  if (
    !rendered ||
    !srcSetHasBase(rendered.srcSet, mount.stagedOriginal, origin)
  ) {
    problems.push('control hero mount does not serve the staged original');
  }
  return problems;
}

function checkLogoMount(section, mount, { arm, origin, surface }) {
  const problems = [];
  if (arm === 'control' && surface === 'store') {
    // Original-renderer lockup: a bare <img> over the staged original
    // (loader ?w&q params are inert for local files).
    const serves = sectionStandaloneImgs(section.html).some(
      (img) =>
        stripQuery(img.src, origin) === mount.stagedOriginal ||
        srcSetHasBase(img.srcset, mount.stagedOriginal, origin)
    );
    if (!serves) {
      problems.push('control lockup does not serve the staged original');
    }
    return problems;
  }
  const pictures = sectionPictures(section.html).filter((picture) =>
    ['header-logo', 'gallery-picture'].includes(pictureKind(picture))
  );
  if (pictures.length === 0) {
    return ['no logo picture mounted'];
  }
  const marked = pictures[0].attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`logo mount is marked for the ${marked} arm`);
  }
  const avif = pictures[0].sources.find(
    (source) => source.type === 'image/avif'
  );
  if (!avif) {
    problems.push('logo mount has no AVIF source');
    return problems;
  }
  if (arm === 'pilot') {
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot logo mount does not serve this generation');
    }
    if (pilotScopeLeaksOriginal(section.html, { arm, origin })) {
      problems.push(
        'pilot logo mount fetches a staged original instead of the generation copy'
      );
    }
  } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
    problems.push('control logo mount does not serve the staged original');
  }
  return problems;
}

function checkCardMount(section, mount, { arm, origin, surface }) {
  const problems = [];
  // Store surface: scope to the selected-card subtree in BOTH arms. The
  // gallery has no grid fillers, so its sections check whole.
  const scope =
    surface === 'store' ? selectedCardSubtree(section.html) : section.html;
  if (surface === 'store' && scope === null) {
    return ['selected card wrapper is absent'];
  }
  if (arm === 'control' && surface === 'store') {
    // Original-renderer grid: the selected card's bare <img> over the staged
    // original. The card path serves absolute same-origin staged URLs (the
    // original renderer rejects relative ones), relativized before
    // comparison. Fillers are outside the scope by construction.
    const serves = sectionStandaloneImgs(scope).some(
      (img) =>
        stripQuery(img.src, origin) === mount.stagedOriginal ||
        srcSetHasBase(img.srcset, mount.stagedOriginal, origin)
    );
    if (!serves) {
      problems.push('control grid does not serve the staged original');
    }
    return problems;
  }
  const kinds =
    surface === 'store' ? ['card-image'] : ['card-image', 'gallery-picture'];
  const pictures = sectionPictures(scope).filter((picture) =>
    kinds.includes(pictureKind(picture))
  );
  if (pictures.length === 0) {
    return ['no card picture mounted'];
  }
  if (surface === 'store' && arm === 'pilot' && pictures.length !== 1) {
    problems.push(
      `pilot grid mounts ${pictures.length} card pictures instead of exactly the mounted card`
    );
  }
  const marked = pictures[0].attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`card mount is marked for the ${marked} arm`);
  }
  const avif = pictures[0].sources.find(
    (source) => source.type === 'image/avif'
  );
  if (!avif) {
    problems.push('card mount has no AVIF source');
    return problems;
  }
  if (arm === 'pilot') {
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot card mount does not serve this generation');
    }
    if (pilotScopeLeaksOriginal(scope, { arm, origin })) {
      problems.push(
        'pilot card mount fetches a staged original instead of the generation copy'
      );
    }
  } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
    problems.push('control card mount does not serve the staged original');
  }
  return problems;
}

function checkMountKind(section, mount, { arm, origin, surface }) {
  if (mount.role === 'hero') {
    return checkHeroMount(section, mount, { arm, origin });
  }
  if (mount.role === 'logo') {
    return checkLogoMount(section, mount, { arm, origin, surface });
  }
  return checkCardMount(section, mount, { arm, origin, surface });
}

// Every intended accepted binding must have an actual mount of the expected
// kind/identity — not just a reporting row. Reporting rows (not-optimized /
// missing-binding) are collected for the audit trail and excluded from
// optimized coverage; an expected mount that renders only a reporting row
// fails.
export function assertServedMountCoverage(
  html,
  { arm, expectedMounts, origin, surface }
) {
  const failures = [];
  const mounted = [];
  const reported = [];
  const sections = extractLabSections(html);
  const byBinding = new Map(
    sections
      .filter((section) => section.binding)
      .map((section) => [section.binding, section])
  );
  for (const section of sections) {
    if (section.status) {
      reported.push({
        binding: section.binding,
        slotId: section.slotId,
        status: section.status,
      });
    }
  }
  for (const mount of expectedMounts ?? []) {
    const name = `mount-coverage:${mount.binding}`;
    const section = byBinding.get(mount.binding);
    if (!section) {
      failures.push(
        `${name}: expected ${mount.slotId} mount is absent from the served ${surface} ${arm} page`
      );
      continue;
    }
    if (section.status) {
      failures.push(
        `${name}: expected ${mount.slotId} mount renders only "${section.status}"`
      );
      continue;
    }
    const problems = checkMountKind(section, mount, { arm, origin, surface });
    if (problems.length > 0) {
      for (const problem of problems) {
        failures.push(`${name}: ${problem}`);
      }
      continue;
    }
    mounted.push(mount.binding);
  }
  return { failures, mounted, reported };
}

// Every served lab URL in one section: picture sources, the section
// preload link, and standalone original-renderer imgs (store control arm).
function sectionLabUrls(sectionHtml, arm) {
  const urls = [];
  for (const picture of sectionPictures(sectionHtml)) {
    for (const source of picture.sources) {
      for (const candidate of srcSetCandidates(source.srcSet)) {
        urls.push(candidate.url);
      }
    }
    if (picture.img?.src) {
      urls.push(picture.img.src);
    }
  }
  for (const link of sectionLinks(sectionHtml, arm)) {
    if (link.href) {
      urls.push(link.href);
    }
    for (const candidate of srcSetCandidates(link.imageSrcSet)) {
      urls.push(candidate.url);
    }
  }
  for (const img of sectionStandaloneImgs(sectionHtml)) {
    if (img.src) {
      urls.push(img.src);
    }
    for (const candidate of srcSetCandidates(img.srcset)) {
      urls.push(candidate.url);
    }
  }
  return urls;
}

async function assertServedDescriptors(html, { arm, origin, publicDir }) {
  const failures = [];
  const name = `served:${arm}:descriptors`;
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    const candidates = [];
    for (const picture of sectionPictures(section.html)) {
      for (const source of picture.sources) {
        candidates.push(...srcSetCandidates(source.srcSet));
      }
    }
    // Standalone original-renderer imgs (store control arm): same rules —
    // loader-param URLs verify existence+decode, bare width descriptors
    // must match the decoded bytes.
    for (const img of sectionStandaloneImgs(section.html)) {
      if (img.src) {
        candidates.push({ descriptor: null, url: img.src });
      }
      candidates.push(...srcSetCandidates(img.srcset));
    }
    for (const candidate of candidates) {
      // Relativize BEFORE the query split: a bare absolute staged URL has
      // no loader params, so it must still verify its width descriptor.
      const path = relativizeServedUrl(candidate.url, origin);
      const base = path.split('?')[0];
      if (!base.startsWith('/__pilot/')) {
        failures.push(
          `${name}: lab srcSet serves a non-lab URL "${candidate.url}"`
        );
        continue;
      }
      // Loader-param URLs (?w&q from the original renderers) name a
      // REQUESTED width, not the encoded width: the staged file must
      // exist and decode, but no descriptor match applies.
      if (path !== base) {
        try {
          await sharp(join(publicDir, base)).metadata();
        } catch {
          failures.push(`${name}: staged file does not decode: "${base}"`);
        }
        continue;
      }
      if (candidate.descriptor === null) {
        // Bare lab URLs (no-op control srcSets, standalone img src):
        // the staged file must exist and decode.
        try {
          await sharp(join(publicDir, base)).metadata();
        } catch {
          failures.push(`${name}: staged file does not decode: "${base}"`);
        }
        continue;
      }
      if (!Number.isInteger(candidate.descriptor) || candidate.descriptor < 1) {
        failures.push(
          `${name}: invalid width descriptor for "${candidate.url}"`
        );
        continue;
      }
      let meta;
      try {
        meta = await sharp(join(publicDir, base)).metadata();
      } catch {
        failures.push(
          `${name}: staged file does not decode: "${candidate.url}"`
        );
        continue;
      }
      if (meta.width !== candidate.descriptor) {
        failures.push(
          `${name}: descriptor ${candidate.descriptor}w does not match decoded width ${meta.width}: "${candidate.url}"`
        );
      }
    }
  }
  return failures;
}

function assertControlPurity(html, { origin } = {}) {
  const leaked = [];
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    for (const url of sectionLabUrls(section.html, 'control')) {
      if (/^\/__pilot\/[0-9a-f]{64}\//.test(stripQuery(url, origin))) {
        leaked.push(url);
      }
    }
  }
  if (leaked.length > 0) {
    return [
      `served:control:no-tier-leak: control arm serves staged derivatives: ${leaked[0]}`,
    ];
  }
  return [];
}

async function assertServedResponseBytes(
  html,
  { arm, origin, publicDir, timeoutMs }
) {
  const failures = [];
  const name = `served:${arm}:response-bytes`;
  const urls = new Set();
  const collect = (url) => {
    if (stripQuery(url, origin).startsWith('/__pilot/')) {
      urls.add(url);
    }
  };
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    for (const url of sectionLabUrls(section.html, arm)) {
      collect(url);
    }
  }
  // Hoisted hint links live in <head>, outside every section: their bytes
  // verify like any other lab URL.
  for (const link of extractLabPreloads(html)) {
    if (link.arm !== arm) {
      continue;
    }
    if (link.href) {
      collect(link.href);
    }
    for (const candidate of srcSetCandidates(link.imageSrcSet)) {
      collect(candidate.url);
    }
  }
  if (urls.size === 0) {
    failures.push(`${name}: no lab image URLs found to verify`);
    return failures;
  }
  for (const urlPath of urls) {
    // Loader-param URLs fetch with the query (as browsers do) but hash
    // against the query-stripped staged file (static serving ignores it).
    const stagedPath = stripQuery(urlPath, origin);
    let expected;
    try {
      expected = await readFile(join(publicDir, stagedPath));
    } catch {
      failures.push(`${name}: no staged file for "${stagedPath}"`);
      continue;
    }
    // Absolute same-origin lab URLs fetch as-is; relative ones resolve
    // against the served origin.
    const fetchUrl = /^https?:\/\//.test(urlPath)
      ? urlPath
      : `${origin.replace(/\/$/, '')}${urlPath}`;
    let response;
    try {
      response = await fetch(fetchUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" failed (${error.message})`
      );
      continue;
    }
    if (!response.ok) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" -> ${response.status}`
      );
      continue;
    }
    const served = Buffer.from(await response.arrayBuffer());
    if (sha256Hex(served) !== sha256Hex(expected)) {
      failures.push(
        `served:${arm}:response-bytes: served bytes differ from the staged hash: "${urlPath}"`
      );
    }
  }
  return failures;
}

async function fetchPage(origin, pagePath, arm, timeoutMs) {
  const url = `${origin.replace(/\/$/, '')}${pagePath}?arm=${arm}`;
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return response.text();
}

// Check-name prefix per page. The gallery keeps the historical
// `served:<arm>:` prefix; store pages are namespaced by slug so one
// failing store cannot hide behind another passing one.
function pageCheckPrefix(page) {
  if (page.surface === 'gallery') {
    return 'served';
  }
  const slug = page.path.split('/').pop() ?? 'store';
  return `served:store:${slug}`;
}

function withPrefix(prefix, name) {
  return name.replace(/^served/, prefix);
}

export async function fetchServedAgreement(
  origin,
  {
    arms,
    expectedBindings,
    expectedMounts = [],
    fetchImpl,
    pages,
    publicDir,
    timeoutMs = 10_000,
  }
) {
  const checks = [];
  const failures = [];
  const coverage = [];
  const effectivePages = pages ?? [
    { bindings: expectedBindings, path: '/pilot-lab', surface: 'gallery' },
  ];
  for (const page of effectivePages) {
    const prefix = pageCheckPrefix(page);
    const pageBindings = page.bindings ?? expectedBindings;
    const pageMounts = (page.mounts ?? expectedMounts).filter((mount) =>
      (pageBindings ?? []).includes(mount.binding)
    );
    for (const arm of arms) {
      const name = `${prefix}:${arm}:reachable`;
      let html;
      try {
        html = fetchImpl
          ? await fetchImpl(page, arm)
          : await fetchPage(origin, page.path, arm, timeoutMs);
      } catch (error) {
        fail(checks, failures, name, String(error.message ?? error));
        continue;
      }
      if (!html.includes(`data-pilot-lab-arm="${arm}"`)) {
        fail(
          checks,
          failures,
          name,
          'served page is not the requested lab arm'
        );
        continue;
      }
      pass(checks, name);
      if (Array.isArray(pageBindings)) {
        const rendered = new Set(extractLabBindings(html));
        const missing = pageBindings.filter(
          (binding) => !rendered.has(binding)
        );
        if (missing.length > 0) {
          fail(
            checks,
            failures,
            `${prefix}:${arm}:binding-coverage`,
            `served page drops bindings: ${missing.join(', ')}`
          );
        } else {
          pass(checks, `${prefix}:${arm}:binding-coverage`);
        }
      }
      const mountCoverage = assertServedMountCoverage(html, {
        arm,
        expectedMounts: pageMounts,
        origin,
        surface: page.surface,
      });
      for (const failure of mountCoverage.failures) {
        fail(
          checks,
          failures,
          `${prefix}:${arm}:mount-coverage`,
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:mount-coverage`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:mount-coverage`);
      }
      coverage.push({
        arm,
        expected: pageMounts.map((mount) => mount.binding),
        mounted: mountCoverage.mounted,
        page: page.path,
        reported: mountCoverage.reported,
      });
      for (const failure of assertServedAgreement(html, { arm })) {
        fail(
          checks,
          failures,
          `${prefix}:${arm}:owner-agreement`,
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:owner-agreement`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:owner-agreement`);
      }
      for (const failure of await assertServedDescriptors(html, {
        arm,
        origin,
        publicDir,
      })) {
        fail(
          checks,
          failures,
          withPrefix(prefix, failure.split(': ')[0]),
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:descriptors`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:descriptors`);
      }
      // Response bytes need a live origin; the HTML-injection seam cannot serve
      // them, so it skips this gate by construction.
      if (!fetchImpl) {
        for (const failure of await assertServedResponseBytes(html, {
          arm,
          origin,
          publicDir,
          timeoutMs,
        })) {
          fail(
            checks,
            failures,
            withPrefix(prefix, failure.split(': ')[0]),
            failure.split(': ').slice(1).join(': ') || failure
          );
        }
        if (
          !failures.some((entry) =>
            entry.startsWith(`${prefix}:${arm}:response-bytes`)
          )
        ) {
          pass(checks, `${prefix}:${arm}:response-bytes`);
        }
      }
      if (arm === 'control') {
        for (const failure of assertControlPurity(html, { origin })) {
          fail(
            checks,
            failures,
            `${prefix}:control:no-tier-leak`,
            failure.split(': ').slice(1).join(': ') || failure
          );
        }
        if (
          !failures.some((entry) =>
            entry.startsWith(`${prefix}:control:no-tier-leak`)
          )
        ) {
          pass(checks, `${prefix}:control:no-tier-leak`);
        }
      }
    }
  }
  return { checks, coverage, failures, ok: failures.length === 0 };
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

export async function runPreflight(options) {
  const offline = await runOfflinePreflight(options);
  if (!options.origin) {
    return { ...offline, served: null };
  }
  // Every inventory binding must render a section in each served arm
  // (accepted mounts and reported not-optimized rows alike); the served
  // gate fails when the route silently drops one. Every offline-accepted
  // binding must additionally have an actual mount of the expected
  // kind/identity on the gallery and on its merchant's store page.
  let inventory = [];
  try {
    const parsed = await readJson(options.inventory);
    if (Array.isArray(parsed)) {
      inventory = parsed;
    }
  } catch {
    inventory = [];
  }
  const expectedBindings = inventory.map(
    (record) => `${record.merchantId}/${record.assetId}`
  );
  let storeMap;
  try {
    storeMap = parseStoreMap(options.storeMap);
  } catch (error) {
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [...offline.failures, `served:store-map: ${error.message}`],
      ok: false,
      served: null,
    };
  }
  const merchants = [...new Set(inventory.map((record) => record.merchantId))];
  const unmapped = merchants.filter((merchant) => !storeMap[merchant]);
  if (unmapped.length > 0) {
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        `served:store-map: no store slug for merchants: ${unmapped.join(', ')}`,
      ],
      ok: false,
      served: null,
    };
  }
  const bindingsFor = (merchantId) =>
    inventory
      .filter((record) => record.merchantId === merchantId)
      .map((record) => `${record.merchantId}/${record.assetId}`);
  const pages = [
    {
      bindings: expectedBindings,
      mounts: offline.accepted,
      path: '/pilot-lab',
      surface: 'gallery',
    },
    ...merchants.map((merchantId) => ({
      bindings: bindingsFor(merchantId),
      mounts: offline.accepted.filter(
        (mount) => mount.merchantId === merchantId
      ),
      path: `/pilot-lab/store/${storeMap[merchantId]}`,
      surface: 'store',
    })),
  ];
  const served = await fetchServedAgreement(options.origin, {
    arms: ['pilot', 'control'],
    expectedBindings,
    expectedMounts: offline.accepted,
    pages,
    publicDir: options.publicDir,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  return {
    accepted: offline.accepted,
    checks: [...offline.checks, ...served.checks],
    coverage: served.coverage,
    failures: [...offline.failures, ...served.failures],
    ok: offline.ok && served.ok,
    served,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parsePreflightArgs(process.argv.slice(2));
  const report = await runPreflight(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    throw new Error(
      `merchant image pilot preflight failed (${report.failures.length} checks)`
    );
  }
}
