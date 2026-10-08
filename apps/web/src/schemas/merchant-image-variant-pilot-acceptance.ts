import { z } from 'zod';
import {
  PILOT_SCHEMA_VERSION,
  PILOT_SHA256_PATTERN,
  PILOT_UUID_PATTERN,
} from './merchant-image-variant-pilot-constants';

// Lab-only reviewer acceptance record. Re-exported from
// merchant-image-variant-pilot.ts; import from there.
export const pilotAcceptanceSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    generationId: z.string().regex(PILOT_SHA256_PATTERN),
    merchantId: z.string().regex(PILOT_UUID_PATTERN),
    note: z.string().min(1).max(500),
    // Tier sha256 in canonical manifest tier order (requestedWidth
    // ascending, avif before webp): matchPilotAcceptance compares
    // positionally, so each hash pins one rung's format, width, and bytes.
    outputHashes: z
      .array(z.string().regex(PILOT_SHA256_PATTERN))
      .min(1)
      .max(24),
    // Reviewed encode quality per tier, same canonical order: a quality
    // change invalidates the acceptance even when the bytes (and their
    // hashes) are unchanged, per the design contract.
    qualities: z
      .array(
        z.union([
          z.literal(70),
          z.literal(65),
          z.literal(60),
          z.literal(55),
          z.null(),
        ])
      )
      .min(1)
      .max(24),
    // The exact original URL the reviewer approved: a retargeted binding
    // (same merchant/asset/hash, new URL) must not activate an old
    // acceptance, per the frozen-binding contract.
    originalUrl: z.url({ protocol: /^https?$/ }),
    recipeId: z.string().min(1).max(64),
    reviewedAt: z.iso.datetime({ offset: true }),
    reviewer: z.string().min(1).max(128),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    sourceSha256: z.string().regex(PILOT_SHA256_PATTERN),
    verdict: z.enum(['accepted', 'rejected']),
  })
  .strict();

export type PilotAcceptance = z.infer<typeof pilotAcceptanceSchema>;

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
