import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ExistingIdempotencyRow,
  findExistingIdempotencyRow,
} from './vtu-idempotency-key-lookup';

/** Admission-stamp failure (the overlap fence requires the stamp). */
export class VtuAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VtuAdmissionError';
  }
}

export interface VtuClaimAdmission {
  existing: ExistingIdempotencyRow | null;
  admittedAt: string;
}

/**
 * Wallet-only claim admission (Codex R3 P1): issues the key-row
 * lookup + DB-clock admission stamp concurrently so no latency is
 * added. The stamp fences the claim overlap (operation admission,
 * not row insert): duplicates admitted while the winner is in
 * flight join even when preparation delays their row past
 * terminalization. Same-clock both sides (DB NOW()): no app/DB
 * skew hazard. Throws VtuAdmissionError when the stamp is
 * unavailable (fail closed before preparing); key-lookup
 * failures propagate unchanged.
 */
export async function admitVtuClaim(
  supabase: SupabaseClient,
  idempotencyKey: string
): Promise<VtuClaimAdmission> {
  const [existing, admission] = await Promise.all([
    findExistingIdempotencyRow(supabase, idempotencyKey),
    supabase.rpc('vtu_admission_timestamp'),
  ]);
  if (admission.error || !admission.data) {
    throw new VtuAdmissionError(
      `Failed to admit VTU claim: ${admission.error?.message ?? 'no timestamp returned'}`
    );
  }
  return { existing, admittedAt: admission.data };
}
