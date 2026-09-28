/** Refuse a notification send when too little cron budget remains to attempt it. */
export function assertRefundNotificationSendTime(deadlineMs?: number): void {
  if (deadlineMs !== undefined && deadlineMs - Date.now() < 20_000) {
    throw new Error('refund_notification_deadline_before_send');
  }
}
