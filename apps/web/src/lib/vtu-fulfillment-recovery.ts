import type { SupabaseClient } from '@supabase/supabase-js';
import { hasExistingVtuDebitLedger } from '@/lib/vtu-debit-ledger-lookup';
import {
  isFlaggedReferenceLessVtuRow,
  isMarkedUnsubmittedMonnifyVtuRow,
  isUnsubmittedPreparedVtuRow,
} from '@/lib/vtu-flagged-recovery';
import type { VtuTransactionRow } from '@/lib/vtu-fulfillment';
import { getSafeMetadataDiagnostics } from '@/lib/vtu-metadata-fields';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';
import {
  isStrandedPreVendVtuRow,
  restoreInterruptedPreVendVtuRow,
} from '@/lib/vtu-pre-vend-recovery';
import { hasVtuCollectionEvidence } from '@/lib/vtu-refund-collection-evidence';
import {
  markVtuProviderSubmissionStarted,
  VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY,
} from '@/lib/vtu-submission-marker';

interface RecoveryInput {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}

/**
 * Stranded pre-vend recovery dispatch. Extracted from
 * `fulfillPendingVtuTransaction` per the 300-line Boy Scout Rule
 * (Codex R64 6rucqp).
 *
 * Returns `'settle-from-provider'` for the flagged reference-less
 * twin (the caller settles it from provider truth — the reconcile
 * path requeries by reference and never vends); every other strand
 * is restored to marked pending for re-drive, or left for the
 * normal state resolution, and returns `'continue'`.
 */
export async function recoverStrandedPreVendVtuRow({
  row,
  supabase,
}: RecoveryInput): Promise<'settle-from-provider' | 'continue'> {
  // Reference-less pre-vend strand (the restore write failed
  // while the database was down): flip back to marked pending so
  // the next pass re-drives it instead of stranding the debit
  // forever. The predicate requires proof no live worker holds
  // the row; re-read after so a raced settle reports terminal.
  // Fail closed (Codex R39 rldXK): flip ONLY when the ledger
  // proves a debit landed (money moved → duty to complete;
  // re-drive is idempotent-safe). A never-debited strand may be
  // a terminal insufficient-balance decline whose failed-persist
  // exhausted — byte-identical to a crash strand — and flipping
  // it would let a later top-up vend a rejected purchase with no
  // new submission. No post-decision write can close this (any
  // such write can exhaust in the same outage as the payload
  // persist), so the safety lives in this read path instead.
  // Never-debited strands stay processing (visible,
  // support-recoverable). A ledger-read failure throws (no flip)
  // — fail closed, the next pass retries the check.
  if (
    isStrandedPreVendVtuRow(row) &&
    (await hasExistingVtuDebitLedger({ row, supabase }))
  ) {
    await restoreInterruptedPreVendVtuRow({
      userSafeMessage: `Reconciliation recovered stranded pre-vend row ${row.id}`,
      row,
      supabase,
    });
  } else if (isUnsubmittedPreparedVtuRow(row)) {
    // Proven-never-submitted twin (Codex R50 6rp7M_): the wallet
    // debit landed but the process died between the debit persist
    // and the first provider call — every direct Kuda purchase
    // has this crash window. Marker absence on a stale
    // marker-era row proves no submission ran, so flip to marked
    // pending and let the next pass re-drive: the debit
    // short-circuits idempotently and the same request_reference
    // submits for the first time (no provider idempotency
    // needed). No ledger gate: walletDebited=true IS the debit
    // proof (it persists only after the debit RPC succeeds).
    // Without this the row falls into the flagged branch below,
    // requeries a never-submitted reference as unknown forever,
    // and strands the debit with no vend and no refund.
    await restoreInterruptedPreVendVtuRow({
      userSafeMessage: `Reconciliation recovered unsubmitted prepared row ${row.id}`,
      row,
      supabase,
    });
  } else if (isMarkedUnsubmittedMonnifyVtuRow(row)) {
    // Marked Monnify gap (Codex R54 6rrFRC): the worker died
    // between the submission-marker persist and the provider
    // call (or the marker response was lost to a dead worker),
    // leaving marker + debit but no response reference — neither
    // re-drivable (unsubmitted proof needs marker absence) nor
    // requeryable (Monnify resolves only by a response
    // vendReference). Flip to marked pending like its
    // unsubmitted twin: the next pass re-drives with the same
    // request_reference, which Monnify receives as its
    // vendReference — the same dedupe assumption the
    // transient-vend path already relies on. Kuda gaps stay out
    // (no dedupe evidence): requery-unknown, support-recoverable.
    await restoreInterruptedPreVendVtuRow({
      userSafeMessage: `Reconciliation recovered marked unsubmitted Monnify row ${row.id}`,
      row,
      supabase,
    });
  } else if (isFlaggedReferenceLessVtuRow(row)) {
    // Post-vend twin of the strand above (mutually exclusive by
    // the flag): the debit provably landed but the result persist
    // exhausted, so the claim declines and pre-vend recovery
    // refuses to re-vend. Settle from provider truth instead —
    // reconcileProcessingVtuTransaction requeries by the
    // persisted reference and never vends. No claim: its markers
    // are diagnostic-only, and settlement is status-CAS plus
    // ledger-idempotent under concurrent passes.
    return 'settle-from-provider';
  }
  return 'continue';
}

/**
 * Persists the provider-submission marker BEFORE the first provider
 * call, so a crash between the wallet-debit persist and the vend is
 * provably unsubmitted (Codex R50 6rp7M_). Fail closed like the
 * walletDebited persist: without the marker the row is
 * indistinguishable from a submitted-but-unpersisted vend, which
 * must never re-drive — so restore to marked pending and throw
 * (the next pass retries the marker write, then vends).
 */
export async function writeVtuProviderSubmissionMarkerOrRestore({
  row,
  supabase,
}: RecoveryInput): Promise<void> {
  const submissionMarkerError = await markVtuProviderSubmissionStarted({
    row,
    supabase,
  });
  if (submissionMarkerError) {
    console.error('Failed to persist VTU provider-submission marker:', {
      error: submissionMarkerError.message,
      transactionId: row.id,
    });
    await restoreInterruptedPreVendVtuRow({
      // Fixed user-safe template: the raw DB error stays in the
      // server log above — error_message is customer-visible history.
      userSafeMessage:
        'VTU purchase confirmation failed; the purchase will resume automatically.',
      row,
      supabase,
    });
    throwVtuPersistenceError(
      `Failed to persist provider-submission marker for ${row.id}: ${submissionMarkerError.message}`
    );
  }
}

/**
 * Persists walletDebited=true after the debit RPC succeeds, so a
 * future retry sees the flag and skips the RPC (it is idempotent
 * anyway, but the flag avoids a round-trip). Fail closed like the
 * rest of fulfillment: without the flag the row is
 * indistinguishable from a never-debited strand, so restore to
 * marked pending and throw (the retry re-drives: the RPC
 * short-circuits on the existing ledger row, the write is retried,
 * then it vends) instead of stranding a reference-less processing
 * row the reconciliation claim declines. Refreshes the row's CAS
 * token and metadata in place for downstream restores.
 *
 * Lost-race CAS (Codex R95 P1): the write gates on
 * status=processing AND the claimed updated_at token (fresh: the
 * fulfillment claim refreshed it in place and no non-terminal
 * write runs between the claim and this persist). A worker paused
 * after its debit RPC would otherwise overwrite a reclaiming
 * worker's submission marker and advance updated_at, letting its
 * own marker CAS succeed too — both workers submitting the same
 * Kuda purchase. Zero-match means another worker moved the row:
 * restore (a no-op against the stale token — the row progressed
 * under the other worker) and throw so the client replays onto
 * the progressed row.
 *
 * Extracted from `fulfillPendingVtuTransaction` per the 300-line
 * Boy Scout Rule (Codex R81 P1).
 */
export async function persistVtuWalletDebitConfirmation({
  preDebitMetadata,
  row,
  supabase,
}: {
  preDebitMetadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<void> {
  const debitedMetadata = { ...preDebitMetadata, walletDebited: true };
  const confirmQuery = supabase
    .from('vtu_transactions')
    .update({ metadata: debitedMetadata })
    .eq('id', row.id)
    .eq('status', 'processing');
  const { data: debitedRow, error: walletDebitedPersistError } =
    await (typeof row.updated_at === 'string'
      ? confirmQuery.eq('updated_at', row.updated_at)
      : confirmQuery
    )
      .select('updated_at')
      .maybeSingle();
  if (walletDebitedPersistError) {
    console.error('Failed to persist VTU walletDebited metadata:', {
      error: walletDebitedPersistError.message,
      metadata: getSafeMetadataDiagnostics(debitedMetadata),
      transactionId: row.id,
    });
    // Ambiguous commit (Codex R105 P1): the UPDATE may have landed
    // while its response was lost — the row would then carry our
    // flag under a newer token, and restoring with the stale token
    // matches nothing, stranding a debited row without a marker
    // until the 5-minute stale gate. Re-read: when the flag is
    // present, the row is still processing, NO submission marker
    // exists yet (whoever flagged has not submitted — a marker
    // means a rival owns submission), and no provider response was
    // persisted, the debit is confirmed — adopt the fresh token +
    // metadata and proceed to the provider instead of restoring.
    // The downstream marker CAS stays the mutex: a concurrent
    // flagger racing us to mark loses exactly one CAS.
    const { data: rereadRow, error: rereadError } = await supabase
      .from('vtu_transactions')
      .select('metadata, status, transaction_id, updated_at')
      .eq('id', row.id)
      .maybeSingle();
    const rereadMetadata =
      !rereadError &&
      rereadRow?.metadata !== null &&
      typeof rereadRow?.metadata === 'object' &&
      !Array.isArray(rereadRow?.metadata)
        ? (rereadRow.metadata as Record<string, unknown>)
        : null;
    const responsePersisted =
      (typeof rereadRow?.transaction_id === 'string' &&
        rereadRow.transaction_id.trim() !== '') ||
      (typeof rereadMetadata?.monnifyVendReference === 'string' &&
        rereadMetadata.monnifyVendReference.trim() !== '');
    if (
      !rereadError &&
      rereadMetadata !== null &&
      rereadMetadata.walletDebited === true &&
      rereadRow?.status === 'processing' &&
      !(VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY in rereadMetadata) &&
      !responsePersisted
    ) {
      if (typeof rereadRow?.updated_at === 'string') {
        row.updated_at = rereadRow.updated_at;
      }
      row.metadata = rereadMetadata;
      return;
    }
    await restoreInterruptedPreVendVtuRow({
      // Fixed user-safe template: the raw DB error stays in the
      // server log above — error_message is customer-visible history.
      userSafeMessage:
        'VTU wallet debit confirmation failed; the purchase will resume automatically.',
      row,
      supabase,
    });
    throwVtuPersistenceError(
      `Failed to persist walletDebited for ${row.id}: ${walletDebitedPersistError.message}`
    );
  }
  if (!debitedRow) {
    console.error('VTU walletDebited confirmation lost race:', {
      transactionId: row.id,
    });
    await restoreInterruptedPreVendVtuRow({
      // Fixed user-safe template (see above). The restore CASes on
      // the stale token, so against the progressed row it no-ops —
      // the throw below is what routes the client replay onto the
      // other worker's progressed row.
      userSafeMessage:
        'VTU wallet debit confirmation conflicted; the purchase will resume automatically.',
      row,
      supabase,
    });
    throwVtuPersistenceError(
      `VTU walletDebited confirmation lost race for ${row.id}: row moved or settled`
    );
  }
  // Refresh the CAS token (Codex R65 6ru4mQ): this write advanced
  // updated_at via trigger — the marker-failure restore below CASes
  // on row.updated_at and would zero-match with the stale token,
  // stranding the charged row until the 5-minute stale path.
  if (typeof debitedRow?.updated_at === 'string') {
    row.updated_at = debitedRow.updated_at;
  }
  // Mutate the row's metadata so downstream code (refund-on-Kuda-fail
  // branch) sees walletDebited=true.
  row.metadata = debitedMetadata;
}

/**
 * True when a legacy card-only refund must be skipped for lack of
 * collection evidence. Legacy failures include gateway-init and
 * declined-authorization rows that never collected — crediting
 * those mints unearned wallet funds (Codex R51 6rqH1I). The caller
 * records the skip; nothing here is retryable, so this never
 * throws.
 */
export async function shouldSkipRefundWithoutCollectionEvidence({
  metadata,
  row,
  supabase,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<boolean> {
  if (await hasVtuCollectionEvidence({ metadata, row, supabase })) {
    return false;
  }
  console.warn(
    'Skipping VTU refund: no collection evidence for card-only row:',
    { transactionId: row.id }
  );
  return true;
}
