export type ScheduledNotificationResultStatus =
  | 'deferred'
  | 'expired'
  | 'failed'
  | 'retry'
  | 'sent';

/**
 * Maps a batch's per-claim results onto the worker health record and HTTP
 * status. A failed finalization leaves its claim unresolved until the lease
 * expires, so it is reported as a failed run rather than a retry.
 */
export function getScheduledNotificationWorkerOutcome(
  results: Array<{ status: ScheduledNotificationResultStatus }>
) {
  const hasFailed = results.some((result) => result.status === 'failed');
  const hasRetry = results.some((result) => result.status === 'retry');

  return {
    errorCode: hasFailed
      ? 'notification_delivery_failed'
      : hasRetry
        ? 'notification_retry'
        : null,
    healthStatus: hasFailed || hasRetry ? 'failed' : 'succeeded',
    httpStatus: hasFailed ? 503 : 200,
  } as const;
}
