import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ExistingIdempotencyRow,
  lookupVtuIdempotencyVerdict,
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
   * The key is mapped under a different customer. The route 400s;
   * a foreign key is never treated as fresh (fresh would prepare +
   * claim a second transaction and, on races, double-charge).
   */
  foreign: boolean;
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
 * short-circuits with null proof, and a foreign key surfaces for
 * the route 400 without needing the proof. Key-lookup failures
 * propagate unchanged.
 *
 * Both RPCs use the authenticated client. The admission RPC resolves
 * the verified caller's customer itself and returns only that customer's
 * live set; the claim enforces the same merchant/customer scope. No
 * merchant-wide snapshot or privileged client crosses this boundary.
 */
export async function admitVtuClaim(
  userSupabase: SupabaseClient,
  idempotencyKey: string,
  userId: string,
  merchantSlug: string,
  fingerprint: string
): Promise<VtuClaimAdmission> {
  const [lookup, proof] = await Promise.all([
    lookupVtuIdempotencyVerdict(userSupabase, idempotencyKey, userId),
    userSupabase.rpc('vtu_admission_proof', {
      p_merchant_slug: merchantSlug,
      p_fingerprint: fingerprint,
    }),
  ]);
  const existing = lookup.row;
  const foreign = lookup.verdict === 'foreign';
  const row = proof.error ? undefined : proof.data?.[0];
  const admittedAt =
    row?.admitted_at && typeof row.admitted_at === 'string'
      ? row.admitted_at
      : null;
  const admissionLive =
    row && Array.isArray(row.live_transaction_ids)
      ? (row.live_transaction_ids as string[])
      : null;
  if (
    (admittedAt === null || admissionLive === null) &&
    !existing &&
    !foreign
  ) {
    throw new VtuAdmissionError(
      `Failed to admit VTU claim: ${proof.error?.message ?? 'no admission proof returned'}`
    );
  }
  return {
    existing,
    foreign,
    proof:
      admittedAt !== null && admissionLive !== null
        ? { admittedAt, admissionLive }
        : null,
  };
}
