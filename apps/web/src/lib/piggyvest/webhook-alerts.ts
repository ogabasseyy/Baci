import { sendPiggyvestMoneyAlert } from '@/lib/posthog/piggyvest-money-alert-events';

/**
 * Alert events for PiggyVest money paths (R5). Every alert writes one
 * structured console line: the log drain pages on the
 * `[PiggyVest Webhook][ALERT]` prefix and routes by code. Each alert is also
 * sent, best effort, as the server-side PostHog event `piggyvest_money_alert`
 * (see `@/lib/posthog/piggyvest-money-alert-events`). Detail is allowlisted
 * and bounded; request bodies, signatures and key material are never written.
 *
 * Codes are declared here once; later work only emits declared codes. The
 * runbook for each one is docs/piggyvest-money-alerts.md.
 */
export const PIGGYVEST_WEBHOOK_ALERT_CODES = [
  'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED',
  'PIGGYVEST_WEBHOOK_KEY_REVOKED',
  'PIGGYVEST_WEBHOOK_CAPTURE_FAILED',
  'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED',
  'PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE',
  'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
  // A captured delivery the worker-host drain is not allowed to replay (it
  // holds no service-role authority): set aside for review, never dropped.
  // A successful provider redelivery still closes it automatically.
  'PIGGYVEST_WEBHOOK_REPLAY_DEFERRED',
  // A transfer reference still unconfirmed past its retry window (TSQ 404
  // or provider-failed): held, never resubmitted or released; an operator
  // must resolve it. Also the code for any stale unconfirmed transfer.
  'PIGGYVEST_TRANSFER_NEEDS_REVIEW',
  // A primary main wallet whose interest routing was contradicted, at
  // onboarding or on a routing-pending recheck: kept rejected and never
  // usable; an operator reviews it (interest settings are immutable).
  'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
  // A primary onboarding whose PiggyVest customer could not be proven ours
  // (several customers, a duplicate, or an unlisted existing one): never
  // adopted; an operator reviews.
  'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
  // A spend or transfer was refused because PiggyVest reports a freeze or
  // lien on the wallet.
  'PIGGYVEST_RESTRICTION_BLOCKED',
  // The daily API reconciliation recorded an interest payout the webhook
  // never delivered (recorded once, by PiggyVest transaction id).
  'PIGGYVEST_INTEREST_BACKFILLED',
  // A deposit's fee could not be matched to the wallet balance change, so
  // the credit is held for review instead of guessed.
  'PIGGYVEST_FEE_UNATTRIBUTED',
  // Interest accrued by a main wallet landed in a main wallet instead of the
  // Interest house wallet; held for review, never credited or swept.
  'PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED',
  // Interest accrued by a goal landed outside that goal (or the goal opted
  // out); it is the customer's money and goes to support review.
  'PIGGYVEST_GOAL_INTEREST_MISROUTED',
  // A confirmed transfer credited a wallet that is not yet PiggyVest-backed;
  // the backed balance is not written until the wallet flips.
  'PIGGYVEST_ENGINE_CREDIT_NOT_BACKED',
  // A wallet's balance is above what we expect by exactly its open inflow
  // reviews: nothing is re-queued until those reviews are resolved.
  'PIGGYVEST_INFLOW_REVIEW_OPEN',
  // A bank deposit arrived for a PiggyVest wallet that maps to no goal or
  // wallet of ours. It is not credited and stays retryable; an operator
  // finds out whose money it is. Goal account numbers are hidden in the app,
  // so any such deposit is unexpected.
  'PIGGYVEST_INFLOW_UNMAPPED',
  // Reserved for drift monitoring: the PiggyVest balance is below what our
  // records expect, so new spends are held. Not emitted yet.
  'PIGGYVEST_NEGATIVE_DRIFT',
  // The daily reconciliation found a transfer stuck past its cutoff, a goal
  // wallet holding less at PiggyVest than we recorded, an unreadable balance,
  // or it could not run. Read-only: a person resolves it.
  'PIGGYVEST_RECONCILIATION_MISMATCH',
  // A savings goal cancel that cannot finish by itself: either the goal also
  // holds legacy contributions or order redemptions (the provider balance
  // would disagree with the local one), or PiggyVest moved the refund but the
  // database refused to settle it (for example a late success while a newer
  // attempt is live). Nothing is resent or released; a person resolves it.
  'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
  // A goal complete that cannot finish by itself: the goal also holds legacy
  // contributions or order redemptions, or PiggyVest moved the balance but
  // the database refused to settle it (it stays held for a person).
  'PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW',
  // A customer completed a goal: the balance is already in their main wallet
  // and a purchase request is saved. The owner fulfils the purchase by hand.
  'PIGGYVEST_GOAL_PURCHASE_REQUEST',
  // A redelivered credit matched a recorded one on pvb_reference with the
  // same money and attribution, but its audit-only eventData internals
  // differ. Deduped (never credited twice); paged so a reused pvb_reference
  // or provider bug is seen instead of silently acked.
  'PIGGYVEST_CREDIT_AUDIT_DRIFT',
  // The degraded-health check (read-only, counts only) saw 3 or more savings
  // transfers still unconfirmed after ten minutes, 3 or more goal-wallet
  // setups not enrolled ten minutes after they started, or could not read
  // either at all.
  'PIGGYVEST_DEGRADED',
] as const;

export type PiggyvestWebhookAlertCode =
  (typeof PIGGYVEST_WEBHOOK_ALERT_CODES)[number];

export interface PiggyvestWebhookAlertDetail {
  keyVersion?: string;
  reason?: string;
  captureId?: string;
  eventType?: string | null;
  attempts?: number;
  operationId?: string;
}

const MAX_DETAIL_LENGTH = 120;

function clip(value: string): string {
  return value.length > MAX_DETAIL_LENGTH
    ? `${value.slice(0, MAX_DETAIL_LENGTH)}…`
    : value;
}

function allowlistedDetail(
  detail: PiggyvestWebhookAlertDetail
): PiggyvestWebhookAlertDetail {
  const safe: PiggyvestWebhookAlertDetail = {};
  if (detail.keyVersion) safe.keyVersion = clip(detail.keyVersion);
  if (detail.reason) safe.reason = clip(detail.reason);
  if (detail.captureId) safe.captureId = clip(detail.captureId);
  if (detail.eventType) safe.eventType = clip(detail.eventType);
  if (typeof detail.attempts === 'number') safe.attempts = detail.attempts;
  if (detail.operationId) safe.operationId = clip(detail.operationId);
  return safe;
}

/**
 * Writes the alert's console line (the primary log-drain page) and nothing
 * else. Split from the PostHog send so a caller can remember "paged" as soon
 * as the line is written, whatever PostHog does.
 */
export function logPiggyvestWebhookAlert(
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail = {}
): void {
  console.error(
    `[PiggyVest Webhook][ALERT] ${code} ${JSON.stringify(allowlistedDetail(detail))}`
  );
}

/**
 * The PostHog half of the alert. Settles with whether the page was sent; it
 * never rejects and is bounded by the send timeout.
 */
export async function sendPiggyvestWebhookAlertDelivered(
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail = {}
): Promise<boolean> {
  try {
    // 'duplicate' means this page was already claimed and sent, so it is
    // delivered; only 'failed' should be retried on redelivery.
    const outcome = await sendPiggyvestMoneyAlert(
      code,
      allowlistedDetail(detail)
    );
    return outcome === 'sent' || outcome === 'duplicate';
  } catch {
    return false;
  }
}

export function emitPiggyvestWebhookAlert(
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail = {}
): void {
  const safe = allowlistedDetail(detail);
  console.error(`[PiggyVest Webhook][ALERT] ${code} ${JSON.stringify(safe)}`);
  try {
    // Fire-and-forget and bounded by a timeout, so it can never delay or
    // change the caller's reply. Rejections are swallowed on purpose: the
    // page is best effort and must never affect the money path.
    sendPiggyvestMoneyAlert(code, safe).catch(() => undefined);
  } catch {
    // The console line above is already written; the page is best effort.
  }
}
