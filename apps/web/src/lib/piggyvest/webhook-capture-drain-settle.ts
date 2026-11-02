import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import type { DrainDeps } from './webhook-capture-drain';
import type { CaptureResolution } from './webhook-capture-queue';

/**
 * How the drain settles a claimed row. Kept apart from the per-row decision
 * logic so each outcome (deferred, needs_review, resolve failure) has one
 * place that sets the state, the error code and the operator alert.
 */

export type RowOutcome = 'processed' | 'retried' | 'needsReview';

export async function settle(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  state: CaptureResolution,
  error: string | null
): Promise<void> {
  try {
    await deps.resolve(row.capture_id, row.claim_token, state, error);
  } catch {
    // The lease expires and the row is claimed again; replay is idempotent.
    console.warn('[PiggyVest Webhook] Failed to resolve captured delivery');
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
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
    captureId: row.capture_id,
    eventType: row.event_type,
    reason: `replay deferred, key set incomplete: ${reason}`,
  });
  await settle(deps, row, 'deferred', 'KEY_SET_INCOMPLETE');
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
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', {
    captureId: row.capture_id,
    eventType: row.event_type,
    keyVersion: row.key_version,
    attempts,
    reason,
  });
  await settle(deps, row, 'needs_review', code);
  return 'needsReview';
}
