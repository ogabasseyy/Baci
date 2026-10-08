import { z } from 'zod';

// Tier schema for pilot manifests: one encoded or pass-through rung.
// Extracted from manifest.mjs so the manifest contract stays under the
// repository's 300-line module ceiling; the manifest-level ladder,
// geometry, budget, and disposition checks stay in manifest.mjs.
export const PilotTierSchema = z
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
    path: z.string().regex(/^[0-9a-f]{64}\.(avif|webp)$/),
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
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(16384),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.path !== `${tier.sha256}.${tier.format}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'path must bind the output hash and format',
      });
    }
    if (tier.contentType !== `image/${tier.format}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content type must match the format',
      });
    }
    if (tier.width !== tier.actualWidth) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'width must equal the encoded width',
      });
    }
    if (tier.delivery === 'original-passthrough' && tier.quality !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pass-through tiers carry no encode quality',
      });
    }
    if (
      (tier.delivery === 'generated' ||
        tier.delivery === 'generated-over-source') &&
      tier.quality === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'generated tiers must carry their encode quality',
      });
    }
  });
