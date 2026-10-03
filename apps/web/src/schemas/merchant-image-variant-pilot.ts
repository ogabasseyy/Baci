import { z } from 'zod';
import { tierContractIssues } from './merchant-image-variant-pilot-tiers';

// Lab-only merchant image variant pilot contract. This Zod v4 mirror must
// stay equivalent to the standalone generator contract in
// infra/cdn-transformer/pilot/{manifest,acceptance}.mjs; both sides validate
// the same shared fixtures in contract-fixtures.json. No native imports here.

export const PILOT_SCHEMA_VERSION = 1;
export const PILOT_POLICY_VERSION = 1;
export const PILOT_RECIPE_ID = 'pilot-r2-a1323f0dc00f1ecb';
export const PILOT_MAX_JOBS = 20;

export const PILOT_TIERS = {
  hero: [384, 768, 1280],
  logo: [96, 192, 384],
  product: [384, 768, 1280],
} as const;

export type PilotRole = keyof typeof PILOT_TIERS;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIER_PATH_PATTERN = /^[0-9a-f]{64}\.(avif|webp)$/;

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
    path: z.string().regex(TIER_PATH_PATTERN),
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
    sha256: z.string().regex(SHA256_PATTERN),
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
        format: z.string().min(1),
        orientedHeight: z.number().int().min(1).max(16384),
        orientedWidth: z.number().int().min(1).max(16384),
        sha256: z.string().regex(SHA256_PATTERN),
      })
      .strict(),
    tiers: z.array(pilotTierSchema).min(1).max(24),
  })
  .strict()
  .superRefine((manifest, context) => {
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
    for (const tier of manifest.tiers) {
      for (const message of tierContractIssues(
        tier,
        manifest.source,
        manifest.recipeId,
        PILOT_RECIPE_ID
      )) {
        context.addIssue({ code: 'custom', message });
      }
    }
  });

export const pilotAcceptanceSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    generationId: z.string().regex(SHA256_PATTERN),
    merchantId: z.uuid(),
    note: z.string().min(1).max(500),
    outputHashes: z.array(z.string().regex(SHA256_PATTERN)).min(1).max(24),
    recipeId: z.string().min(1).max(64),
    reviewedAt: z.iso.datetime({ offset: true }),
    reviewer: z.string().min(1).max(128),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    sourceSha256: z.string().regex(SHA256_PATTERN),
    verdict: z.enum(['accepted', 'rejected']),
  })
  .strict();

export const pilotInventoryBindingSchema = z
  .object({
    assetId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    merchantId: z.uuid(),
    originalUrl: z.url({ protocol: /^https?$/ }),
    role: z.enum(['logo', 'product', 'hero']),
    slotId: z.string().min(1).max(128),
    sourceSha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

export type PilotManifest = z.infer<typeof pilotManifestSchema>;
export type PilotAcceptance = z.infer<typeof pilotAcceptanceSchema>;
export type PilotInventoryBinding = z.infer<typeof pilotInventoryBindingSchema>;

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

export function parsePilotAcceptance(
  value: unknown
): { ok: true; record: PilotAcceptance } | { ok: false; issues: string[] } {
  const parsed = pilotAcceptanceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { ok: true, record: parsed.data };
}

export function parsePilotInventoryBinding(
  value: unknown
):
  | { ok: true; binding: PilotInventoryBinding }
  | { ok: false; issues: string[] } {
  const parsed = pilotInventoryBindingSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { binding: parsed.data, ok: true };
}

export function matchPilotAcceptance(input: {
  acceptance: PilotAcceptance;
  manifest: PilotManifest;
}): { ok: true } | { ok: false; reason: string } {
  const { acceptance, manifest } = input;
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
  if (acceptance.recipeId !== manifest.recipeId) {
    return { ok: false, reason: 'recipe changed' };
  }
  const manifestHashes = [
    ...new Set(manifest.tiers.map((tier) => tier.sha256)),
  ].sort();
  const recordHashes = [...new Set(acceptance.outputHashes)].sort();
  if (
    manifestHashes.length !== recordHashes.length ||
    manifestHashes.some((hash, index) => hash !== recordHashes[index])
  ) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  return { ok: true };
}
