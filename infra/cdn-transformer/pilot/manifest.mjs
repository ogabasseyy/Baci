import { z } from 'zod';
import {
  ACCEPTED_INPUT_FORMATS,
  BUDGETS,
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  RECIPE_ID,
  TIERS,
} from './constants.mjs';

export class PilotManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PilotManifestError';
  }
}

export {
  buildEncoderIdentity,
  currentRecipeId,
  generationIdFor,
} from './generation-identity.mjs';

export function outputFileName(sha256, format) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new PilotManifestError('bad-request', 'output name needs a sha256');
  }
  if (format !== 'avif' && format !== 'webp') {
    throw new PilotManifestError('bad-request', 'output name needs a format');
  }
  return `${sha256}.${format}`;
}

const TierSchema = z
  .object({
    actualWidth: z.number().int().min(1).max(16384),
    bytes: z.number().int().min(1),
    contentType: z.enum(['image/avif', 'image/webp']),
    // Delivery disposition (recipe r2): 'generated' and
    // 'original-passthrough' are capped at source bytes, while
    // 'generated-over-source' is the explicit over-source exception.
    // Absent on frozen r1 manifests, which keep their legacy meaning.
    delivery: z.enum(['generated', 'original-passthrough', 'generated-over-source']).optional(),
    format: z.enum(['avif', 'webp']),
    height: z.number().int().min(1).max(16384),
    path: z.string().regex(/^[0-9a-f]{64}\.(avif|webp)$/),
    // Pass-through tiers reuse validated source bytes, so no ladder
    // quality applies; generated tiers always carry their encode quality.
    quality: z.union([z.literal(70), z.literal(65), z.literal(60), z.literal(55), z.null()]),
    requestedWidth: z.number().int().min(1).max(16384),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(16384),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.path !== `${tier.sha256}.${tier.format}`) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'path must bind the output hash and format' });
    }
    if (tier.contentType !== `image/${tier.format}`) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'content type must match the format' });
    }
    if (tier.width !== tier.actualWidth) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'width must equal the encoded width' });
    }
    if (tier.delivery === 'original-passthrough' && tier.quality !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'pass-through tiers carry no encode quality' });
    }
    if (
      (tier.delivery === 'generated' || tier.delivery === 'generated-over-source') &&
      tier.quality === null
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'generated tiers must carry their encode quality' });
    }
  });

export const PilotManifestSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    createdAt: z.string().datetime({ offset: true }),
    encoder: z
      .object({
        libvipsVersion: z.string().min(1),
        name: z.literal('sharp'),
        sharpVersion: z.string().min(1),
      })
      .strict(),
    merchantId: z.string().uuid(),
    policyVersion: z.literal(PILOT_POLICY_VERSION),
    recipeId: z.string().min(1).max(64),
    role: z.enum(['logo', 'product', 'hero']),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    source: z
      .object({
        bytes: z.number().int().min(1),
        format: z.enum(ACCEPTED_INPUT_FORMATS),
        orientedHeight: z.number().int().min(1).max(16384),
        orientedWidth: z.number().int().min(1).max(16384),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    tiers: z.array(TierSchema).min(1).max(24),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expected = new Set();
    for (const width of TIERS[manifest.role] ?? []) {
      for (const format of ['avif', 'webp']) {
        expected.add(`${width}:${format}`);
      }
    }
    const seen = new Set();
    for (const tier of manifest.tiers) {
      const key = `${tier.requestedWidth}:${tier.format}`;
      if (!expected.has(key) || seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" is unexpected or duplicated`,
        });
      }
      seen.add(key);
    }
    if (seen.size !== expected.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tiers must cover the full role ladder exactly once',
      });
    }
    // Canonical order (requestedWidth ascending, avif before webp): the
    // acceptance binds output hashes positionally, so a reordered ladder
    // would let swapped tier claims certify against the wrong rung.
    const rank = (tier) =>
      tier.requestedWidth * 10 + (tier.format === 'avif' ? 0 : 1);
    for (let index = 1; index < manifest.tiers.length; index += 1) {
      if (rank(manifest.tiers[index]) < rank(manifest.tiers[index - 1])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tiers must list the role ladder in canonical order',
        });
        break;
      }
    }
    // Per-disposition invariants hold only where a disposition is recorded;
    // legacy tiers without one are exempt (frozen r1 keeps its meaning).
    // 'generated' is capped at source bytes; 'generated-over-source' must
    // exceed them (the exception must actually hold).
    for (const tier of manifest.tiers) {
      const key = `${tier.requestedWidth}:${tier.format}`;
      // Recipe byte ceilings bind every encoded tier — including frozen r1
      // legacy (the encoder enforces budgets on every encode) and
      // over-source (the exception records bytes above the SOURCE, still
      // within the rung budget). Only pass-through reuses source bytes
      // outside the ladder budgets.
      if (tier.delivery !== 'original-passthrough') {
        const ceiling =
          BUDGETS[manifest.role]?.[tier.requestedWidth]?.[tier.format];
        if (ceiling === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" has no recipe ceiling for role "${manifest.role}"`,
          });
        } else if (tier.bytes > ceiling) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" exceeds the recipe byte ceiling (${tier.bytes} > ${ceiling})`,
          });
        }
      }
      if (tier.delivery === undefined) {
        // Delivery-less tiers are frozen r1 legacy. A current-recipe
        // manifest that omits delivery would skip every never-larger
        // check and activate unguarded, so the omission is rejected.
        if (manifest.recipeId === RECIPE_ID) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" omits delivery for the current recipe`,
          });
        }
        continue;
      }
      if (tier.delivery === 'generated' && tier.bytes > manifest.source.bytes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" claims generated delivery above the source bytes`,
        });
      }
      if (
        tier.delivery === 'generated-over-source' &&
        (tier.bytes <= manifest.source.bytes || tier.format === manifest.source.format)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" claims an over-source limitation that does not hold`,
        });
      }
      if (tier.delivery === 'original-passthrough') {
        const matchesSource =
          tier.bytes === manifest.source.bytes &&
          tier.sha256 === manifest.source.sha256 &&
          tier.width === manifest.source.orientedWidth &&
          tier.height === manifest.source.orientedHeight &&
          tier.format === manifest.source.format;
        if (!matchesSource) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" pass-through must reuse the validated source bytes, dimensions, and codec`,
          });
        }
      }
      if (
        tier.delivery === 'generated' ||
        tier.delivery === 'generated-over-source'
      ) {
        // Encoded tiers bind to the source ladder: no upscaling past the
        // source, no narrowed/1px claims, aspect preserved within the same
        // ±1px height tolerance the encoder verifies its own output with.
        // (Pass-through tiers are exempt: they carry source dimensions,
        // bound exactly by the check above.)
        const encodedWidth = Math.min(
          tier.requestedWidth,
          manifest.source.orientedWidth
        );
        if (tier.width !== encodedWidth) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" width ${tier.width} is not the encoded rung width ${encodedWidth}`,
          });
        } else {
          const idealHeight = Math.round(
            (manifest.source.orientedHeight * tier.width) /
              manifest.source.orientedWidth
          );
          if (Math.abs(tier.height - idealHeight) > 1) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `tier "${key}" height ${tier.height} breaks the source aspect ratio (expected ${idealHeight}±1)`,
            });
          }
        }
      }
    }
  });

export function parsePilotManifest(value) {
  const parsed = PilotManifestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { manifest: parsed.data, ok: true };
}

