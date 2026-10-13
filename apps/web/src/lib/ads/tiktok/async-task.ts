import 'server-only';

import type { TikTokAdsAsyncTaskStatus } from './provider-types';

function record(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function parseTikTokAdsAsyncTaskStatus(
  payload: unknown
): TikTokAdsAsyncTaskStatus | null {
  const status = record(record(payload)?.data)?.task_status;
  return status === 'QUEUING' ||
    status === 'PROCESSING' ||
    status === 'SUCCESS' ||
    status === 'FAILED' ||
    status === 'CANCELED'
    ? status
    : null;
}
