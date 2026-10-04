// Offline per-binding stages: manifest contract, committed tier bytes, and
// staged derivatives/originals. Tiers must decode to their manifest
// geometry in the declared container; staged copies must hash identically.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  normalizeFormat,
  orientedDimensions,
} from '../../../../infra/cdn-transformer/pilot/encode-worker.mjs';
import { assertManifestContract } from './merchant-image-pilot-preflight-manifest.mjs';
import { stagedOriginalName } from './merchant-image-pilot-preflight-records.mjs';
import {
  fail,
  pass,
  positionalHashesMatch,
  readJson,
  sha256Hex,
  TIER_FILE,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function checkBindingManifest({
  acceptance,
  checks,
  effectiveRecipe,
  failures,
  inputBytes,
  name,
  options,
  record,
}) {
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
    return null;
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
    return null;
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
    return null;
  }
  // Source-fact binding: the never-larger policy compares tier bytes
  // against manifest.source.bytes, so the claimed byte count, format, and
  // oriented dimensions must match the hash-verified input — a matching
  // SHA alone leaves the policy inputs unbound. Decoded from the verified
  // buffer, never re-read from disk.
  if (inputBytes.length !== manifest.source.bytes) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      `manifest source claims ${manifest.source.bytes} bytes but the verified input is ${inputBytes.length} bytes`
    );
    return null;
  }
  let meta;
  try {
    meta = await sharp(inputBytes).metadata();
  } catch {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      'verified input does not decode for source-fact comparison'
    );
    return null;
  }
  const decodedFormat = normalizeFormat(meta);
  if (decodedFormat !== manifest.source.format) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      `manifest source claims format "${manifest.source.format}" but the verified input decodes as "${decodedFormat ?? 'unknown'}"`
    );
    return null;
  }
  const oriented = orientedDimensions(meta);
  if (
    oriented.width !== manifest.source.orientedWidth ||
    oriented.height !== manifest.source.orientedHeight
  ) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      `manifest source claims ${manifest.source.orientedWidth}x${manifest.source.orientedHeight} but the verified input decodes ${oriented.width}x${oriented.height}`
    );
    return null;
  }
  if (
    !positionalHashesMatch(
      manifest.tiers.map((tier) => tier.sha256),
      acceptance.outputHashes
    )
  ) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      'encoded output bytes changed: acceptance hashes differ from manifest tiers'
    );
    return null;
  }
  pass(checks, `${name}:manifest`);
  return manifest;
}

export async function checkBindingTiers({
  acceptance,
  checks,
  failures,
  manifest,
  name,
  options,
}) {
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
      return false;
    }
    if (bytes.length !== tier.bytes || sha256Hex(bytes) !== tier.sha256) {
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
      meta = await sharp(bytes).metadata();
    } catch {
      fail(
        checks,
        failures,
        `${name}:tiers`,
        `committed output does not decode: ${tier.path}`
      );
      return false;
    }
    // Oriented geometry: an EXIF-rotated pass-through tier records its
    // oriented axes in the manifest, while sharp reports the stored axes
    // plus an orientation tag.
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

export async function checkBindingStaged({
  acceptance,
  checks,
  failures,
  manifest,
  name,
  options,
  record,
}) {
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
      return false;
    }
    if (staged.length !== tier.bytes || sha256Hex(staged) !== tier.sha256) {
      fail(
        checks,
        failures,
        `${name}:staged`,
        `staged derivative hash mismatch: ${tier.path}`
      );
      return false;
    }
  }
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
    return false;
  }
  if (sha256Hex(stagedOriginal) !== record.sha256) {
    fail(
      checks,
      failures,
      `${name}:staged`,
      `staged original hash mismatch: ${originalName}`
    );
    return false;
  }
  pass(checks, `${name}:staged`);
  return true;
}
