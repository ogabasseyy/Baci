import { STRANDED_PRE_VEND_STALE_MS } from './vtu-pre-vend-recovery';
import { VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY } from './vtu-submission-marker';

/** Structural shape the flagged-row predicate needs. */
export interface FlaggedReferenceLessRowCandidate {
  created_at?: string | null;
  error_message?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  request_reference?: string | null;
  status?: string | null;
  transaction_id?: string | null;
  updated_at?: string | null;
}

/**
 * Marker-era flag prepare writes on every new vtu_transactions row
 * (see preparePendingVtuTransaction). The unsubmitted proof keys
 * off this flag's PRESENCE — never a date cutoff: a cutoff is only
 * correct when the deploy lands after it, so rows created between
 * an early deploy and the cutoff would strand despite being
 * provably unsubmitted (Codex R55 6rrU6H). The flag ships with
 * this PR, so its presence proves the row was prepared by
 * marker-aware code regardless of when the deploy lands; its
 * absence (every pre-merge row) proves nothing, and those rows
 * keep today's behavior (requery-only, support-recoverable)
 * rather than risk double value.
 */
export const VTU_SUBMISSION_MARKER_ERA_KEY = 'submissionMarkerEra';

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
 * refunded on ambiguous evidence — EXCEPT marker-era rows with no
 * submission marker, which isUnsubmittedPreparedVtuRow proves never
 * submitted and re-drives (checked first at the call site).
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

/**
 * True for a processing row PROVABLY never submitted: the wallet
 * debit landed (walletDebited persists only after the debit RPC
 * succeeds) but the process died between the debit persist and the
 * first provider call — every direct Kuda purchase has this crash
 * window. Without this path the row matches
 * isFlaggedReferenceLessVtuRow, reconciliation only requeries Kuda,
 * the never-submitted reference reports unknown forever, and the
 * customer stays charged with no vend and no refund.
 *
 * The unsubmitted proof is marker absence: fulfill persists
 * VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY immediately BEFORE the
 * first provider call (single funnel — Kuda, Monnify, and fallback
 * all flow through it), so on a stale marker-era row the marker's
 * absence means no provider call ever ran. Re-driving reuses the
 * row's request_reference, which submits for the first time — safe
 * without relying on provider idempotency. The debit
 * short-circuits idempotently on re-drive (cached ledger row).
 *
 * Carved OUT of the flagged set (checked first at the call site):
 * any marker presence — even malformed — takes the requery-only
 * path, as does a Monnify vend reference (deploy-slip defense: old
 * code never wrote the marker but did persist references for landed
 * Monnify vends). Rows without the marker-era flag are excluded
 * too: their marker absence proves nothing (pre-merge code never
 * wrote the marker). Stale-only, same 5-minute proof as pre-vend:
 * a live worker is between persists, not past them.
 */
export function isUnsubmittedPreparedVtuRow(
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
  // Prepared proof (see docblock): the debit landed, so re-driving
  // is the completion duty — and it short-circuits idempotently.
  if (row.metadata?.walletDebited !== true) {
    return false;
  }
  // Unsubmitted proof (see docblock): any marker presence — even
  // malformed — fails toward the requery-only path.
  if (
    row.metadata != null &&
    VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY in row.metadata
  ) {
    return false;
  }
  // Monnify submitted proof (deploy-slip defense, see docblock).
  const vendReference = row.metadata?.monnifyVendReference;
  if (typeof vendReference === 'string' && vendReference) {
    return false;
  }
  // Legacy exclusion: rows without the marker-era flag were
  // prepared by pre-merge code that never knew the marker, so
  // their marker absence is not unsubmitted evidence.
  if (
    row.metadata == null ||
    !(VTU_SUBMISSION_MARKER_ERA_KEY in row.metadata)
  ) {
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

/**
 * True for a processing Monnify row stranded between the
 * submission-marker persist and the provider call (Codex R54
 * 6rrFRC): the marker proves this worker got that far, but no
 * provider response reference exists, so the row can neither
 * re-drive (marker presence fails the unsubmitted proof) nor
 * requery (Monnify resolves ONLY by a response vendReference).
 * Re-driving re-submits the same request_reference as Monnify's
 * vendReference — the SAME dedupe assumption the transient-vend
 * path already makes for response-unknown Monnify rows — rather
 * than stranding the debit. Kuda rows are excluded: re-vend has
 * no dedupe evidence there, so they stay requery-only
 * (visible, support-recoverable).
 *
 * The provider gate also excludes mid-fallback crashes for free:
 * the Kuda fallback overwrites metadata.provider to 'kuda'
 * before dispatching, so provider === 'monnify' with no response
 * reference means Monnify itself never answered. Presence-based
 * (only new code writes the marker), so no era gate; stale-only
 * like its siblings — a live worker is between persists.
 */
export function isMarkedUnsubmittedMonnifyVtuRow(
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
  if (row.metadata?.provider !== 'monnify') {
    return false;
  }
  // Marker presence (see docblock): absence belongs to the
  // unsubmitted-prepared path, checked first at the call site.
  // (metadata is non-null here: null fails the provider gate.)
  if (!(VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY in row.metadata)) {
    return false;
  }
  // A response vend reference means the vend ran: requery-only.
  const vendReference = row.metadata.monnifyVendReference;
  if (typeof vendReference === 'string' && vendReference.trim() !== '') {
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
