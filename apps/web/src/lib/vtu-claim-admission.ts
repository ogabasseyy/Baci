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

export interface VtuAdmissionProof {
  admittedAt: string;
  /** Scope transactions live at admission (commit-safe fence input). */
  admissionLive: string[];
}

export interface VtuClaimAdmission {
  existing: ExistingIdempotencyRow | null;
  /**
   * Null on the replay short-circuit (Codex P2): an existing row
   * replays without the proof — the replay path never uses the
   * stamp or the live set, so a proof-RPC outage must not lock
   * customers out of retrieving an already-debited result.
   */
  proof: VtuAdmissionProof | null;
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
 * for a FRESH key (fail closed before preparing); an existing row
 * short-circuits with null proof fields. Key-lookup failures
 * propagate unchanged.
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
  const row = proof.error ? undefined : proof.data?.[0];
  const admittedAt =
    row?.admitted_at && typeof row.admitted_at === 'string'
      ? row.admitted_at
      : null;
  const admissionLive =
    row && Array.isArray(row.live_transaction_ids)
      ? (row.live_transaction_ids as string[])
      : null;
  if ((admittedAt === null || admissionLive === null) && !existing) {
    throw new VtuAdmissionError(
      `Failed to admit VTU claim: ${proof.error?.message ?? 'no admission proof returned'}`
    );
  }
  return {
    existing,
    proof:
      admittedAt !== null && admissionLive !== null
        ? { admittedAt, admissionLive }
        : null,
  };
}
