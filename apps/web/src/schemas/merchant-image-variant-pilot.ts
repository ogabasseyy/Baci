import { z } from 'zod';
import type { PilotAcceptance } from './merchant-image-variant-pilot-acceptance';
import type { PilotInventoryBinding } from './merchant-image-variant-pilot-binding';
import {
  PILOT_MAX_DECODED_PIXELS,
  PILOT_POLICY_VERSION,
  PILOT_RECIPE_ID,
  PILOT_SCHEMA_VERSION,
  PILOT_SHA256_PATTERN,
  PILOT_TIER_PATH_PATTERN,
  PILOT_TIERS,
} from './merchant-image-variant-pilot-constants';
import { tierContractIssues } from './merchant-image-variant-pilot-tiers';

export type { PilotAcceptance } from './merchant-image-variant-pilot-acceptance';
export {
  parsePilotAcceptance,
  pilotAcceptanceSchema,
} from './merchant-image-variant-pilot-acceptance';
export type { PilotInventoryBinding } from './merchant-image-variant-pilot-binding';
export {
  parsePilotInventoryBinding,
  pilotInventoryBindingSchema,
} from './merchant-image-variant-pilot-binding';
export type { PilotRole } from './merchant-image-variant-pilot-constants';
// Lab-only merchant image variant pilot contract. This Zod v4 mirror must
// stay equivalent to the standalone generator contract in
// infra/cdn-transformer/pilot/{manifest,acceptance}.mjs; both sides validate
// the same shared fixtures in contract-fixtures.json. No native imports here.
//
// Public barrel: constants, acceptance, and binding live in sibling modules
// and are re-exported here so existing importers are unaffected.
export {
  PILOT_MAX_DECODE_CHANNELS,
  PILOT_MAX_DECODED_PIXELS,
  PILOT_MAX_JOBS,
  PILOT_POLICY_VERSION,
  PILOT_RECIPE_ID,
  PILOT_SCHEMA_VERSION,
  PILOT_SHARP_LIMITS,
  PILOT_TIERS,
} from './merchant-image-variant-pilot-constants';

const pilotTierSchema = z
  .object({
    actualWidth: z.number().int().min(1).max(16384),
    bytes: z.number().int().min(1),
    contentType: z.enum(['image/avif', 'image/webp']),
    // Delivery disposition (recipe r2): 'generated' and
    // 'original-passthrough' are capped at source bytes, while
    // 'generated-over-source' is the explicit over-source exception.
    // Absent on frozen r1 manifests, which keep their legacy meaning.
    delivery: z
      .enum(['generated', 'original-passthrough', 'generated-over-source'])
      .optional(),
    format: z.enum(['avif', 'webp']),
    height: z.number().int().min(1).max(16384),
    path: z.string().regex(PILOT_TIER_PATH_PATTERN),
    // Pass-through tiers reuse validated source bytes, so no ladder
    // quality applies; generated tiers always carry their encode quality.
    quality: z.union([
      z.literal(70),
      z.literal(65),
      z.literal(60),
      z.literal(55),
      z.null(),
    ]),
    requestedWidth: z.number().int().min(1).max(16384),
    sha256: z.string().regex(PILOT_SHA256_PATTERN),
    width: z.number().int().min(1).max(16384),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.path !== `${tier.sha256}.${tier.format}`) {
      context.addIssue({
        code: 'custom',
        message: 'path must bind the output hash and format',
      });
    }
    if (tier.contentType !== `image/${tier.format}`) {
      context.addIssue({
        code: 'custom',
        message: 'content type must match the format',
      });
    }
    if (tier.width !== tier.actualWidth) {
      context.addIssue({
        code: 'custom',
        message: 'width must equal the encoded width',
      });
    }
    if (tier.delivery === 'original-passthrough' && tier.quality !== null) {
      context.addIssue({
        code: 'custom',
        message: 'pass-through tiers carry no encode quality',
      });
    }
    if (
      (tier.delivery === 'generated' ||
        tier.delivery === 'generated-over-source') &&
      tier.quality === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'generated tiers must carry their encode quality',
      });
    }
  });

export const pilotManifestSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    createdAt: z.iso.datetime({ offset: true }),
    encoder: z
      .object({
        libvipsVersion: z.string().min(1),
        name: z.literal('sharp'),
        sharpVersion: z.string().min(1),
      })
      .strict(),
    merchantId: z.uuid(),
    policyVersion: z.literal(PILOT_POLICY_VERSION),
    recipeId: z.string().min(1).max(64),
    role: z.enum(['logo', 'product', 'hero']),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    source: z
      .object({
        bytes: z.number().int().min(1),
        // Generator-supported inputs only (mirrors ACCEPTED_INPUT_FORMATS
        // in infra/cdn-transformer/pilot/constants.mjs): a hash-valid
        // manifest claiming gif/svg would pass source verification yet
        // describe an input class the generator rejects.
        format: z.enum(['avif', 'jpeg', 'png', 'webp']),
        orientedHeight: z.number().int().min(1).max(16384),
        orientedWidth: z.number().int().min(1).max(16384),
        sha256: z.string().regex(PILOT_SHA256_PATTERN),
      })
      .strict(),
    tiers: z.array(pilotTierSchema).min(1).max(24),
  })
  .strict()
  .superRefine((manifest, context) => {
    // Decoded-pixel ceiling (mirrors the generator's
    // assertAcceptedMetadata and SHARP_LIMITS): each axis can pass while
    // the area describes an input the generator would refuse to encode.
    if (
      manifest.source.orientedWidth * manifest.source.orientedHeight >
      PILOT_MAX_DECODED_PIXELS
    ) {
      context.addIssue({
        code: 'custom',
        message: 'source decoded pixels exceed the generator limit',
      });
    }
    const expected = new Set<string>();
    for (const width of PILOT_TIERS[manifest.role] ?? []) {
      for (const format of ['avif', 'webp'] as const) {
        expected.add(`${width}:${format}`);
      }
    }
    const seen = new Set<string>();
    for (const tier of manifest.tiers) {
      const key = `${tier.requestedWidth}:${tier.format}`;
      if (!expected.has(key) || seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `tier "${key}" is unexpected or duplicated`,
        });
      }
      seen.add(key);
    }
    if (seen.size !== expected.size) {
      context.addIssue({
        code: 'custom',
        message: 'tiers must cover the full role ladder exactly once',
      });
    }
    // Canonical order (requestedWidth ascending, avif before webp): the
    // acceptance binds output hashes positionally, so a reordered ladder
    // would let swapped tier claims certify against the wrong rung.
    const rank = (tier: { format: string; requestedWidth: number }): number =>
      tier.requestedWidth * 10 + (tier.format === 'avif' ? 0 : 1);
    for (let index = 1; index < manifest.tiers.length; index += 1) {
      const previous = manifest.tiers[index - 1];
      const current = manifest.tiers[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        rank(current) < rank(previous)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'tiers must list the role ladder in canonical order',
        });
        break;
      }
    }
    for (const tier of manifest.tiers) {
      for (const message of tierContractIssues(
        tier,
        manifest.source,
        manifest.recipeId,
        PILOT_RECIPE_ID,
        manifest.role
      )) {
        context.addIssue({ code: 'custom', message });
      }
    }
  });

export type PilotManifest = z.infer<typeof pilotManifestSchema>;

export function parsePilotManifest(
  value: unknown
): { ok: true; manifest: PilotManifest } | { ok: false; issues: string[] } {
  const parsed = pilotManifestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { manifest: parsed.data, ok: true };
}

export function matchPilotAcceptance(input: {
  acceptance: PilotAcceptance;
  binding: PilotInventoryBinding;
  manifest: PilotManifest;
}): { ok: true } | { ok: false; reason: string } {
  const { acceptance, binding, manifest } = input;
  if (acceptance.verdict !== 'accepted') {
    return { ok: false, reason: 'visual verdict is not accepted' };
  }
  if (acceptance.merchantId !== manifest.merchantId) {
    return { ok: false, reason: 'merchant mismatch' };
  }
  if (acceptance.assetId !== manifest.assetId) {
    return { ok: false, reason: 'asset mismatch' };
  }
  if (acceptance.sourceSha256 !== manifest.source.sha256) {
    return { ok: false, reason: 'source bytes changed' };
  }
  if (acceptance.originalUrl !== binding.originalUrl) {
    return { ok: false, reason: 'original URL changed' };
  }
  if (acceptance.recipeId !== manifest.recipeId) {
    return { ok: false, reason: 'recipe changed' };
  }
  // Positional binding: outputHashes lists tier sha256 in canonical
  // manifest tier order, so each accepted hash pins one rung's format,
  // width, and bytes. A sorted-set comparison would let swapped tier
  // claims (or deduped capped rungs) certify unchanged.
  if (acceptance.outputHashes.length !== manifest.tiers.length) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  const swapped = manifest.tiers.findIndex(
    (tier, index) => tier.sha256 !== acceptance.outputHashes[index]
  );
  if (swapped !== -1) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  return { ok: true };
}
