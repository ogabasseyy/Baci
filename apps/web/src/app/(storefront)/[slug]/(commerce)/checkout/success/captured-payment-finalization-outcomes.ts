// captured the money (mirrors finalizeOrderGatewayPayment kinds): never
// payment failures — the reverify loop keeps polling for completion.
// capture_hold_failed joins them: the hold record failed but the capture
// is durable, so the shopper must keep waiting, never re-pay.
const CAPTURED_PAYMENT_FINALIZATION_OUTCOMES = new Set([
  'capture_hold_failed',
  'completion_failed',
  'inventory_cleanup_failed',
  'inventory_failed',
  'order_fetch_failed',
  'review_failed',
]);

export function isCapturedPaymentFinalizationOutcome(
  outcome: unknown
): boolean {
  return (
    typeof outcome === 'string' &&
    CAPTURED_PAYMENT_FINALIZATION_OUTCOMES.has(outcome)
  );
}
