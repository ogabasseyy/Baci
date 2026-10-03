// Standalone manifest-contract mirror (route zod schema in
// schemas/merchant-image-variant-pilot.ts, reference in
// pilot/manifest.mjs). Every rule is cross-checked by the shared
// contract-fixtures corpus consumed by all three suites, so drift breaks
// loudly. Returns the issue list (empty = valid).
import { TIERS } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  DELIVERIES,
  ENCODER_KEYS,
  FORMATS,
  HEX64,
  isIntIn,
  isPlainObject,
  isRouteDatetime,
  MANIFEST_KEYS,
  QUALITIES,
  SOURCE_KEYS,
  TIER_FILE,
  TIER_KEYS,
  UUID,
} from './merchant-image-pilot-preflight-shared.mjs';

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
