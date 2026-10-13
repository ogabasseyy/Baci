export const REFUND_NOTIFICATION_SEND_ADMISSION_REFUSED =
  'refund_notification_deadline_before_send';

/** Refuse a notification send when too little cron budget remains to attempt it. */
export function assertRefundNotificationSendTime(
  deadlineMs?: number,
  requiredMs = 20_000
): void {
  if (deadlineMs !== undefined && deadlineMs - Date.now() < requiredMs) {
    throw new Error(REFUND_NOTIFICATION_SEND_ADMISSION_REFUSED);
  }
}

/** Whether the error is a pre-send budget refusal (never attempted). */
export function isRefundNotificationSendAdmissionRefusal(
  error: unknown
): boolean {
  return (
    error instanceof Error &&
    error.message === REFUND_NOTIFICATION_SEND_ADMISSION_REFUSED
  );
}
