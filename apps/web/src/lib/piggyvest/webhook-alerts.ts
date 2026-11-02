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
  // Reserved for drift monitoring: the PiggyVest balance is below what our
  // records expect, so new spends are held. Not emitted yet.
  'PIGGYVEST_NEGATIVE_DRIFT',
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
