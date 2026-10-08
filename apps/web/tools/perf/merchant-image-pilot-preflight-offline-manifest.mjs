// Offline manifest stage: contract, identity, generation binding, source
// facts, and positional acceptance hashes for one binding.
import { join } from 'node:path';
import sharp from 'sharp';
import { SHARP_LIMITS } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  assertAcceptedMetadata,
  normalizeFormat,
  orientedDimensions,
} from '../../../../infra/cdn-transformer/pilot/encode-worker.mjs';
import { generationIdFor } from '../../../../infra/cdn-transformer/pilot/generation-identity.mjs';
import { assertManifestContract } from './merchant-image-pilot-preflight-manifest.mjs';
import {
  fail,
  pass,
  positionalHashesMatch,
  positionalQualitiesMatch,
  readJson,
  resolveGenerationDir,
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
  try {
    await resolveGenerationDir(options.outputRoot, acceptance.generationId);
  } catch (error) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
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
  // Approval identity: the acceptance reviewed one exact original URL. A
  // retargeted inventory record (same merchant/asset/hash, new URL) must
  // not activate the old acceptance.
  if (acceptance.originalUrl !== record.url) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      'original URL changed since the acceptance review'
    );
    return null;
  }
  // Generation-identity binding: recompute the content-derived ID the
  // same way the runtime does, so a valid generation copied or renamed
  // under another directory never passes offline preflight while the
  // runtime rejects it as binding-mismatch.
  const expectedGenerationId = generationIdFor({
    encoderIdentity: manifest.encoder,
    job: {
      assetId: record.assetId,
      merchantId: record.merchantId,
      role: record.role,
    },
    recipeId: manifest.recipeId,
    sourceSha256: manifest.source.sha256,
  });
  if (expectedGenerationId !== acceptance.generationId) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      'generation directory is not the recipe output for this binding'
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
  // Same decoder limits as the generator: animation, channel count,
  // axis, and pixel area are enforced before the source facts bind.
  let meta;
  try {
    meta = await sharp(inputBytes, { ...SHARP_LIMITS }).metadata();
    assertAcceptedMetadata(meta);
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
  if (
    !positionalQualitiesMatch(
      manifest.tiers.map((tier) => tier.quality ?? null),
      acceptance.qualities
    )
  ) {
    fail(
      checks,
      failures,
      `${name}:manifest`,
      'tier quality changed: acceptance qualities differ from manifest tiers'
    );
    return null;
  }
  pass(checks, `${name}:manifest`);
  return manifest;
}
