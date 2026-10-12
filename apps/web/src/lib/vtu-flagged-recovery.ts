import { STRANDED_PRE_VEND_STALE_MS } from './vtu-pre-vend-recovery';

/** Structural shape the flagged-row predicate needs. */
export interface FlaggedReferenceLessRowCandidate {
  error_message?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  request_reference?: string | null;
  status?: string | null;
  transaction_id?: string | null;
  updated_at?: string | null;
}

/**
 * True for a processing row the reconciliation claim declines (no
 * provider reference or message) that PROVABLY moved money: fulfill
 * persists metadata.walletDebited only after the wallet debit RPC
 * succeeds, so the flag is post-vend evidence — the vend may have
 * landed while the result persist exhausted. Pre-vend recovery
 * rightly refuses to re-vend these (double-credit); instead the
 * caller requeries provider truth by the persisted request reference
 * (Kuda BILL_TSQ resolves by BillRequestRef) or Monnify vend
 * reference and settles without ever vending. The requery key must
 * be present for the row's route: Kuda's keyless status call reports
 * failed, which would wrongfully fail/refund, and Monnify resolves
 * ONLY by its vendReference. Stale-only (same 5-minute proof as
 * pre-vend): a mid-flight vend misread as failed would refund while
 * value lands. Fail closed on missing/invalid timestamps. Rows that
 * stay provider-unknown (never submitted before the crash) keep
 * returning processing — visible and retried, never wrongfully
 * refunded on ambiguous evidence.
 */
export function isFlaggedReferenceLessVtuRow(
  row: FlaggedReferenceLessRowCandidate,
  nowMs: number = Date.now()
): boolean {
  if (row.status !== 'processing') {
    return false;
  }
  if (row.transaction_id?.trim()) {
    return false;
  }
  if (row.error_message?.trim()) {
    return false;
  }
  if (row.metadata?.walletDebited !== true) {
    return false;
  }
  const provider = row.metadata?.provider;
  const requestReference =
    typeof row.request_reference === 'string'
      ? row.request_reference.trim()
      : '';
  const monnifyVendReference =
    typeof row.metadata?.monnifyVendReference === 'string'
      ? row.metadata.monnifyVendReference.trim()
      : '';
  if (provider === 'monnify' ? !monnifyVendReference : !requestReference) {
    return false;
  }
  if (!row.updated_at) {
    return false;
  }
  const updatedAtMs = new Date(row.updated_at).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return nowMs - updatedAtMs > STRANDED_PRE_VEND_STALE_MS;
}
