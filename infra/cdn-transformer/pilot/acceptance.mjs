import { z } from 'zod';
import { PILOT_SCHEMA_VERSION } from './constants.mjs';

export const PilotAcceptanceSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    generationId: z.string().regex(/^[0-9a-f]{64}$/),
    merchantId: z.string().uuid(),
    note: z.string().min(1).max(500),
    // Tier sha256 in canonical manifest tier order (requestedWidth
    // ascending, avif before webp): matchAcceptance compares positionally.
    outputHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(24),
    // Mirror of the web acceptance originalUrl: the exact URL the reviewer
    // approved. Zod v3 has no protocol option, so http(s) is refined.
    originalUrl: z
      .string()
      .url()
      .refine(
        (value) => {
          try {
            const protocol = new URL(value).protocol;
            return protocol === 'http:' || protocol === 'https:';
          } catch {
            return false;
          }
        },
        { message: 'original URL must use http(s)' }
      ),
    recipeId: z.string().min(1).max(64),
    reviewedAt: z.string().datetime({ offset: true }),
    reviewer: z.string().min(1).max(128),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    verdict: z.enum(['accepted', 'rejected']),
  })
  .strict();

export function parsePilotAcceptance(value) {
  const parsed = PilotAcceptanceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { ok: true, record: parsed.data };
}

// A changed source, recipe, merchant, asset, or encoded byte invalidates the
// acceptance. Only a matching `accepted` record permits lab use; anything
// else leaves the original control active.
export function matchAcceptance({ acceptance, binding, manifest }) {
  if (acceptance.verdict !== 'accepted') {
    return { ok: false, reason: 'visual verdict is not accepted' };
  }
  if (acceptance.merchantId !== manifest.merchantId) {
    return { ok: false, reason: 'merchant mismatch' };
  }
  if (acceptance.assetId !== manifest.assetId) {
    return { ok: false, reason: 'asset mismatch' };
  }
  if (acceptance.sourceSha256 !== manifest.source?.sha256) {
    return { ok: false, reason: 'source bytes changed' };
  }
  if (acceptance.originalUrl !== binding?.originalUrl) {
    return { ok: false, reason: 'original URL changed' };
  }
  if (acceptance.recipeId !== manifest.recipeId) {
    return { ok: false, reason: 'recipe changed' };
  }
  // Positional binding: outputHashes lists tier sha256 in canonical
  // manifest tier order, so each accepted hash pins one rung's format,
  // width, and bytes. A sorted-set comparison would let swapped tier
  // claims (or deduped capped rungs) certify unchanged.
  const recordHashes = acceptance.outputHashes ?? [];
  if (recordHashes.length !== (manifest.tiers ?? []).length) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  const swapped = (manifest.tiers ?? []).findIndex(
    (tier, index) => tier.sha256 !== recordHashes[index]
  );
  if (swapped !== -1) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  return { ok: true };
}
