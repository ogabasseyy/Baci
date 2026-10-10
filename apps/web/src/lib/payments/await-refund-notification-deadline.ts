/** Rejection message when the wait stops with dispatch possibly in flight. */
export const REFUND_NOTIFICATION_DELIVERY_DEADLINE =
  'refund_notification_delivery_deadline';

/** Stop waiting in time to persist an indeterminate delivery outcome. */
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
          () => reject(new Error(REFUND_NOTIFICATION_DELIVERY_DEADLINE)),
          remainingMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
