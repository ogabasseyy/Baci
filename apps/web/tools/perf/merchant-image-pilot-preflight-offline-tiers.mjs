// Offline tier stage: committed tier bytes decode to their manifest
// geometry in the declared container.
import { join } from 'node:path';
import sharp from 'sharp';
import { SHARP_LIMITS } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  assertAcceptedMetadata,
  orientedDimensions,
} from '../../../../infra/cdn-transformer/pilot/encode-worker.mjs';
import {
  fail,
  pass,
  readUpToBytes,
  resolveGenerationDir,
  sha256Hex,
  TIER_FILE,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function checkBindingTiers({
  acceptance,
  checks,
  failures,
  manifest,
  name,
  options,
}) {
  try {
    await resolveGenerationDir(options.outputRoot, acceptance.generationId);
  } catch (error) {
    fail(
      checks,
      failures,
      `${name}:tiers`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
  for (const tier of manifest.tiers) {
    const match = TIER_FILE.exec(tier.path ?? '');
    if (!match || match[1] !== tier.sha256 || match[2] !== tier.format) {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `tier file name "${tier.path}" is not bound to its hash/format`
      );
      return false;
    }
    // Bounded by the claimed size: a corrupted tier replaced with a huge
    // file rejects on size without allocating the whole file.
    let bytes;
    let truncated = false;
    try {
      ({ bytes, truncated } = await readUpToBytes(
        join(
          options.outputRoot,
          'generations',
          acceptance.generationId,
          tier.path
        ),
        tier.bytes
      ));
    } catch {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `committed output missing: ${tier.path}`
      );
      return false;
    }
    if (
      truncated ||
      bytes.length !== tier.bytes ||
      sha256Hex(bytes) !== tier.sha256
    ) {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `committed output hash mismatch: ${tier.path}`
      );
      return false;
    }
    let meta;
    try {
      // Same decoder limits as the generator: animation, channel count,
      // and pixel area are enforced on every verified tier.
      meta = await sharp(bytes, { ...SHARP_LIMITS }).metadata();
      assertAcceptedMetadata(meta);
      // metadata() is header-only: force a full pixel decode so truncated
      // AVIF bodies fail here instead of in a browser.
      await sharp(bytes, { ...SHARP_LIMITS }).stats();
    } catch {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `committed output does not decode: ${tier.path}`
      );
      return false;
    }
    // Oriented geometry: pass-through tiers record oriented axes, while
    // sharp reports stored axes plus an orientation tag.
    const oriented = orientedDimensions(meta);
    if (oriented.width !== tier.width || oriented.height !== tier.height) {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `decoded dimensions ${oriented.width}x${oriented.height} differ from manifest ${tier.width}x${tier.height}: ${tier.path}`
      );
      return false;
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
      return false;
    }
  }
  pass(checks, `${name}:tiers`);
  return true;
}
