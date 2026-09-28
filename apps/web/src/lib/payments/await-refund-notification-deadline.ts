/** Stop waiting in time to persist an indeterminate delivery outcome. */
export function assertRefundNotificationSendTime(deadlineMs?: number): void {
  if (deadlineMs !== undefined && deadlineMs - Date.now() < 20_000) {
    throw new Error('refund_notification_deadline_before_send');
  }
}

export async function awaitRefundNotificationDeadline<T>(
  work: Promise<T>,
  deadlineMs?: number
): Promise<T> {
  if (deadlineMs === undefined) return work;
  const remainingMs = Math.max(1, deadlineMs - Date.now() - 10_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('refund_notification_delivery_deadline')),
          remainingMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
