/** Refuse a notification send when too little cron budget remains to attempt it. */
export function assertRefundNotificationSendTime(
  deadlineMs?: number,
  requiredMs = 20_000
): void {
  if (deadlineMs !== undefined && deadlineMs - Date.now() < requiredMs) {
    throw new Error('refund_notification_deadline_before_send');
  }
}
