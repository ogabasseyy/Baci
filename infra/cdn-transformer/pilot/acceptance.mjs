import { z } from 'zod';
import { PILOT_SCHEMA_VERSION } from './constants.mjs';

export const PilotAcceptanceSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    generationId: z.string().regex(/^[0-9a-f]{64}$/),
    merchantId: z.string().uuid(),
    note: z.string().min(1).max(500),
    outputHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(24),
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

function sortedUniqueHashes(hashes) {
  return [...new Set(hashes)].sort();
}

// A changed source, recipe, merchant, asset, or encoded byte invalidates the
// acceptance. Only a matching `accepted` record permits lab use; anything
// else leaves the original control active.
export function matchAcceptance({ acceptance, manifest }) {
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
  if (acceptance.recipeId !== manifest.recipeId) {
    return { ok: false, reason: 'recipe changed' };
  }
  const manifestHashes = sortedUniqueHashes(
    (manifest.tiers ?? []).map((tier) => tier.sha256)
  );
  const recordHashes = sortedUniqueHashes(acceptance.outputHashes ?? []);
  if (
    manifestHashes.length !== recordHashes.length ||
    manifestHashes.some((hash, index) => hash !== recordHashes[index])
  ) {
    return { ok: false, reason: 'encoded output bytes changed' };
  }
  return { ok: true };
}
