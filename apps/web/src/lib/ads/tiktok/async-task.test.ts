import { describe, expect, it } from 'vitest';
import { parseTikTokAdsAsyncTaskStatus } from './async-task';

describe('TikTok async task status parser', () => {
  it('accepts only the provider task states', () => {
    expect(
      parseTikTokAdsAsyncTaskStatus({ data: { task_status: 'PROCESSING' } })
    ).toBe('PROCESSING');
    expect(
      parseTikTokAdsAsyncTaskStatus({ data: { task_status: 'unknown' } })
    ).toBeNull();
  });
});
