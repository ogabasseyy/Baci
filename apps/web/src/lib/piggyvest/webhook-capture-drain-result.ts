import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import type { DrainDeps } from './webhook-capture-drain';
import {
  deferForIncompleteKeySet,
  parkContentQuarantined,
  parkForReview,
  type RowOutcome,
  setAsideOutOfScope,
  settle,
} from './webhook-capture-drain-settle';

/**
 * How the drain settles a verified row after its processing attempt.
 * Kept apart from the pre-processing authority checks in
 * webhook-capture-drain.ts; the order of the branches is the contract.
 */

export const MAX_DRAIN_ATTEMPTS = 20;

/**
 * What one processing attempt reported. A non-2xx status means incomplete,
 * and so does every marker: none of them is ever resolved processed.
 */
export interface ReplayProcessResult {
  status: number;
  /** The wrong key family signed it; no financial handler ran. */
  authorizationQuarantine?: boolean;
  /** The body was unparseable or schema-rejected. */
  contentQuarantine?: boolean;
  /** Only a complete key set can settle it (a family failed to load). */
  keySetIncomplete?: boolean;
  /** The master kill switch deferred the delivery without spending an attempt. */
  killSwitchDeferred?: boolean;
  /** The primary path declined and its authorized legacy fallback is unconfigured. */
  legacyIntakeUnavailable?: boolean;
  /** The enabled direct primary inflow fallback has invalid configuration. */
  primaryInflowUnavailable?: boolean;
  /** Same event identity, different content: a person must decide. */
  conflict?: boolean;
  /** The row needs a processing path this runtime does not hold. */
  outOfScope?: string;
}

/** `result` is null when processing threw. */
export async function settleReplayResult(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  result: ReplayProcessResult | null,
  verifiedWithIncompleteKeySet: boolean
): Promise<RowOutcome> {
  const completed =
    result !== null &&
    result.status >= 200 &&
    result.status < 300 &&
    result.authorizationQuarantine !== true &&
    result.contentQuarantine !== true &&
    result.keySetIncomplete !== true &&
    result.killSwitchDeferred !== true &&
    result.legacyIntakeUnavailable !== true &&
    result.primaryInflowUnavailable !== true &&
    result.conflict !== true &&
    result.outOfScope === undefined;
  if (completed) {
    return (await settle(deps, row, 'processed', null))
      ? 'processed'
      : 'retried';
  }
  if (result?.outOfScope !== undefined) {
    // Not this runtime's to judge: the key set and attempt count are
    // irrelevant, the path it needs simply is not here.
    return setAsideOutOfScope(deps, row, result.outOfScope);
  }
  if (result?.killSwitchDeferred === true) {
    await settle(deps, row, 'deferred', 'KILL_SWITCH_ACTIVE');
    return 'retried';
  }
  if (result?.conflict === true) {
    return parkForReview(
      deps,
      row,
      'REPLAY_CONFLICT',
      'same event identity with different content; review before any credit'
    );
  }
  if (result?.contentQuarantine === true) {
    return parkContentQuarantined(deps, row);
  }
  if (result?.legacyIntakeUnavailable === true) {
    await settle(deps, row, 'deferred', 'LEGACY_INTAKE_UNAVAILABLE');
    return 'retried';
  }
  if (result?.primaryInflowUnavailable === true) {
    await settle(deps, row, 'deferred', 'PRIMARY_INFLOW_UNAVAILABLE');
    return 'retried';
  }
  if (result?.keySetIncomplete === true || verifiedWithIncompleteKeySet) {
    // The key set is incomplete (the replay verified under only the
    // families that loaded), so ANY unsuccessful outcome (a non-2xx answer,
    // a thrown error, an authorization quarantine, or the explicit marker)
    // may just be the missing assignment. It is not a failure of the row:
    // defer (attempt refunded, bounded backoff, never dead-lettered) so a
    // repaired configuration resumes it.
    await deferForIncompleteKeySet(deps, row, 'processing incomplete');
    return 'retried';
  }
  if (result?.authorizationQuarantine === true) {
    // Signed by a family not authorized for this event, with a complete key
    // set and immutable recorded authority: replay can never succeed, so it
    // must not take 20 batch slots. A correctly signed redelivery has its
    // own capture row.
    return parkForReview(
      deps,
      row,
      'REPLAY_AUTHORIZATION_QUARANTINED',
      'signed by a key family not authorized for this event'
    );
  }
  if (row.attempts >= MAX_DRAIN_ATTEMPTS) {
    return parkForReview(
      deps,
      row,
      'PROCESSING_ATTEMPTS_EXHAUSTED',
      'processing attempts exhausted',
      row.attempts
    );
  }
  await settle(deps, row, 'pending', 'PROCESSING_INCOMPLETE');
  return 'retried';
}
