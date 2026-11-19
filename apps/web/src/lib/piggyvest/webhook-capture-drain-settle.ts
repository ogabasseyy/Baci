import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import type { DrainDeps } from './webhook-capture-drain';
import { captureFailureDetail } from './webhook-capture-failure-detail';
import type { CaptureResolution } from './webhook-capture-queue';
import { parseStoredPiggyvestEvent } from './webhook-capture-stored-event';

/**
 * How the drain settles a claimed row. Kept apart from the per-row decision
 * logic so each outcome (deferred, needs_review, resolve failure) has one
 * place that sets the state, the error code and the operator alert. An
 * outcome is only counted, and its alert only raised, once the database
 * recorded it; otherwise the row counts as retried.
 */

export type RowOutcome = 'processed' | 'retried' | 'needsReview';

/**
 * True only when the database recorded the resolution. False when this
 * pass no longer holds the lease (another pass re-claimed the row, so it
 * settles it instead) or the database failed (the lease expires and the
 * row is claimed again); replay is idempotent either way.
 */
export async function settle(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  state: CaptureResolution,
  error: string | null
): Promise<boolean> {
  try {
    return await deps.resolve(row.capture_id, row.claim_token, state, error);
  } catch (caughtError) {
    console.warn('[PiggyVest Webhook] Failed to resolve captured delivery', {
      captureId: row.capture_id,
      ...captureFailureDetail(caughtError, 'settle'),
    });
    return false;
  }
}

/**
 * Defer a row because the key set is incomplete. Nothing about the row is
 * judged (even a permanent failure stays recoverable), so the deferral must
 * be visible: operators learn about the incomplete configuration from the
 * alert instead of finding stuck rows later. No secret or body is logged.
 */
export async function deferForIncompleteKeySet(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  reason: string
): Promise<void> {
  if (!(await settle(deps, row, 'deferred', 'KEY_SET_INCOMPLETE'))) return;
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
    captureId: row.capture_id,
    eventType: row.event_type,
    reason: `replay deferred, key set incomplete: ${reason}`,
  });
}

/**
 * Set aside a row this drain runtime must not replay (`scope` names why, for
 * example LEGACY_FAMILY: the worker host holds no service-role authority).
 * The row leaves the claimable set (needs_review), so such rows can never
 * crowd out work this runtime can finish, and the receiver keeps asking for
 * redelivery while it is in review. A redelivery the receiver completes
 * inline still closes it as processed. No secret or body is logged.
 */
export async function setAsideOutOfScope(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  scope: string
): Promise<RowOutcome> {
  const code = `REPLAY_OUT_OF_SCOPE_${scope}`;
  if (!(await settle(deps, row, 'needs_review', code))) return 'retried';
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_REPLAY_DEFERRED', {
    captureId: row.capture_id,
    eventType: row.event_type,
    reason: `set aside for review: ${scope}; a provider redelivery closes it`,
  });
  return 'needsReview';
}

/**
 * Park a row for review: the alert names the capture (and never a secret or
 * the body) so operators can act, and the row leaves the claimable set.
 */
export async function parkForReview(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  code: string,
  reason: string,
  attempts?: number
): Promise<RowOutcome> {
  if (!(await settle(deps, row, 'needs_review', code))) return 'retried';
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', {
    captureId: row.capture_id,
    eventType: row.event_type,
    keyVersion: row.key_version,
    attempts,
    reason,
  });
  return 'needsReview';
}

/**
 * The stored bytes verified (or were admitted) but the parser rejects them,
 * so no key set can change the outcome: only a parser fix plus an operator
 * replay of this stored capture can make them processable. PiggyVest has no
 * resend endpoint (confirmed 2026-11-11), so the capture is the only copy.
 */
export function parkContentQuarantined(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture
): Promise<RowOutcome> {
  return parkForReview(
    deps,
    row,
    'REPLAY_CONTENT_QUARANTINED',
    'body rejected by the parser; replay this capture after the fix (no provider resend exists)'
  );
}

/**
 * The scope check runs before verification and replay, so nothing has read
 * the body yet: one the parser rejects is parked as a content quarantine
 * (what the receiver leaves such a row pending for), so the review reason
 * says what is actually wrong. Anything else is set aside under its scope.
 */
export function setAsideBeforeReplay(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  scope: string
): Promise<RowOutcome> {
  return parseStoredPiggyvestEvent(Buffer.from(row.raw_hex, 'hex'))
    ? setAsideOutOfScope(deps, row, scope)
    : parkContentQuarantined(deps, row);
}
