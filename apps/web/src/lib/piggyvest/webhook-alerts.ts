/**
 * Alert events for the PiggyVest receiver (R5). One structured console line
 * per event: the log drain pages on the `[PiggyVest Webhook][ALERT]` prefix
 * and routes by code. Detail is allowlisted and bounded; request bodies,
 * signatures and key material are never written.
 */
export type PiggyvestWebhookAlertCode =
  | 'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED'
  | 'PIGGYVEST_WEBHOOK_KEY_REVOKED'
  | 'PIGGYVEST_WEBHOOK_CAPTURE_FAILED'
  | 'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED'
  | 'PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE'
  | 'PIGGYVEST_WEBHOOK_NEEDS_REVIEW';

export interface PiggyvestWebhookAlertDetail {
  keyVersion?: string;
  reason?: string;
  captureId?: string;
  eventType?: string | null;
  attempts?: number;
}

const MAX_DETAIL_LENGTH = 120;

function clip(value: string): string {
  return value.length > MAX_DETAIL_LENGTH
    ? `${value.slice(0, MAX_DETAIL_LENGTH)}…`
    : value;
}

export function emitPiggyvestWebhookAlert(
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail = {}
): void {
  const safe: Record<string, string | number> = {};
  if (detail.keyVersion) safe.keyVersion = clip(detail.keyVersion);
  if (detail.reason) safe.reason = clip(detail.reason);
  if (detail.captureId) safe.captureId = clip(detail.captureId);
  if (detail.eventType) safe.eventType = clip(detail.eventType);
  if (typeof detail.attempts === 'number') safe.attempts = detail.attempts;
  console.error(`[PiggyVest Webhook][ALERT] ${code} ${JSON.stringify(safe)}`);
}
