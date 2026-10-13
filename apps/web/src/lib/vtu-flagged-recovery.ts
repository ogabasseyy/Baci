import type { SupabaseClient } from '@supabase/supabase-js';
import { STRANDED_PRE_VEND_STALE_MS } from './vtu-pre-vend-recovery';

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
 * Metadata key: ISO timestamp fulfill persists immediately BEFORE
 * the first provider submission. Marker absence on a stale
 * marker-era row proves no provider call ever ran (every submission
 * path writes it first), which is what lets the reconciler re-drive
 * the row with the same request reference instead of stranding the
 * debit forever — no provider idempotency needed, since the
 * reference submits for the first time.
 */
export const VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY =
  'providerSubmissionStartedAt';

/**
 * The submission marker shipped with this recovery (2026-10-20).
 * Rows created before it never knew the marker, so marker absence
 * on them proves nothing — re-driving one could double-credit a
 * legacy purchase whose provider call already landed. Only
 * marker-era rows are eligible for unsubmitted-row recovery. The
 * cutoff sits after the expected deploy: old code serving past it
 * would mint eligible-looking legacy strands, so do not backdate
 * it. Pre-cutoff strands keep today's behavior (requery-only,
 * support-recoverable) rather than risk double value.
 */
export const STRANDED_UNSUBMITTED_MIN_CREATED_MS = Date.parse(
  '2026-10-20T00:00:00.000Z'
);

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
 * Monnify vends). Pre-marker-era rows are excluded too: their
 * marker absence proves nothing. Stale-only, same 5-minute proof
 * as pre-vend: a live worker is between persists, not past them.
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
  // Legacy exclusion: pre-marker rows never knew the marker, so
  // their marker absence is not unsubmitted evidence. Fail closed
  // on missing or unparseable timestamps.
  if (!row.created_at) {
    return false;
  }
  const createdAtMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  if (createdAtMs < STRANDED_UNSUBMITTED_MIN_CREATED_MS) {
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

/**
 * Persists the provider-submission marker immediately before the
 * first provider call (see VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY).
 * Returns the persist error message, or null on success (row
 * metadata is updated in place so downstream code sees the
 * marker). Fail closed: the caller must NOT vend when this fails —
 * without the marker the row is indistinguishable from a
 * submitted-but-unpersisted vend, which must never re-drive.
 *
 * Read-back verify (Codex R54 6rrFRC): the UPDATE may have
 * committed while its response was lost (timeout/kill during the
 * RTT). Without a re-read that row sits processing with the marker
 * and no provider reference — the reconciler can neither re-drive
 * it (marker presence fails the unsubmitted proof) nor settle it
 * (nothing to requery). A re-read marker with no response
 * reference is provably OURS — this worker never dispatched a
 * provider call on the linear path here, and every other vend
 * entry needs a stale-or-pending row — so adopt it and proceed to
 * the vend. Any other outcome (re-read error, vanished row, moved
 * status, or a response reference) keeps the original error and
 * the caller's CAS-guarded restore.
 */
export async function markVtuProviderSubmissionStarted({
  row,
  supabase,
}: {
  row: { id: string; metadata?: Record<string, unknown> | null };
  supabase: SupabaseClient;
}): Promise<{ message: string } | null> {
  const metadata = {
    ...(row.metadata ?? {}),
    [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('vtu_transactions')
    .update({ metadata })
    .eq('id', row.id);
  if (!error) {
    row.metadata = metadata;
    return null;
  }
  const { data: current, error: rereadError } = await supabase
    .from('vtu_transactions')
    .select('metadata, status, transaction_id')
    .eq('id', row.id)
    .maybeSingle();
  if (rereadError || !current) {
    return { message: error.message };
  }
  const currentMetadata =
    current.metadata !== null &&
    typeof current.metadata === 'object' &&
    !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : null;
  const markerPresent =
    currentMetadata !== null &&
    VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY in currentMetadata;
  const responsePersisted =
    (typeof current.transaction_id === 'string' &&
      current.transaction_id.trim() !== '') ||
    (typeof currentMetadata?.monnifyVendReference === 'string' &&
      currentMetadata.monnifyVendReference.trim() !== '');
  if (!markerPresent || responsePersisted || current.status !== 'processing') {
    return { message: error.message };
  }
  row.metadata = currentMetadata;
  return null;
}
