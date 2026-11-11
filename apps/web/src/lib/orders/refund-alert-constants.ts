/** Total send attempts per review before the alert is abandoned. */
export const REFUND_ALERT_RETRY_CAP = 3;

/** Below this much remaining phase budget the alert is deferred, unclaimed. */
export const MIN_ALERT_BUDGET_MS = 8_000;
