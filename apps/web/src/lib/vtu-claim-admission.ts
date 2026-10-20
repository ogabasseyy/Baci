import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ExistingIdempotencyRow,
  findExistingIdempotencyRow,
} from './vtu-idempotency-key-lookup';

/** Admission-proof failure (the overlap fence requires the proof). */
export class VtuAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VtuAdmissionError';
  }
}

export interface VtuClaimAdmission {
  existing: ExistingIdempotencyRow | null;
  admittedAt: string;
  /** Scope transactions live at admission (commit-safe fence input). */
  admissionLive: string[];
}

/**
 * Wallet-only claim admission (Codex R3 P1, R4 P1): issues the
 * key-row lookup + DB admission proof concurrently so no latency
 * is added. The proof is atomic (stamp + live-scope snapshot under
 * one statement snapshot): the claim joins terminals live at
 * admission — terminalized inside our own window — regardless of
 * their xact-start stamp, which can predate the writer's commit
 * (comparing it against any post-commit timestamp is unsound).
 * Same-clock both sides (DB statement time): no app/DB skew
 * hazard. Throws VtuAdmissionError when the proof is unavailable
 * (fail closed before preparing); key-lookup failures propagate
 * unchanged.
 */
export async function admitVtuClaim(
  supabase: SupabaseClient,
  idempotencyKey: string,
  merchantSlug: string,
  fingerprint: string
): Promise<VtuClaimAdmission> {
  const [existing, proof] = await Promise.all([
    findExistingIdempotencyRow(supabase, idempotencyKey),
    supabase.rpc('vtu_admission_proof', {
      p_merchant_slug: merchantSlug,
      p_fingerprint: fingerprint,
    }),
  ]);
  const row = proof.data?.[0];
  if (
    proof.error ||
    !row?.admitted_at ||
    !Array.isArray(row.live_transaction_ids)
  ) {
    throw new VtuAdmissionError(
      `Failed to admit VTU claim: ${proof.error?.message ?? 'no admission proof returned'}`
    );
  }
  return {
    existing,
    admittedAt: row.admitted_at,
    admissionLive: row.live_transaction_ids,
  };
}
