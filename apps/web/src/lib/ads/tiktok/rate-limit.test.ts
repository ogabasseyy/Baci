import { describe, expect, it } from 'vitest';
import { TikTokAdsRateLimiter } from './rate-limit';

describe('TikTok Ads per-process request limiter', () => {
  it('serializes concurrent calls below the Basic 10-QPS provider limit', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new TikTokAdsRateLimiter({
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);
    expect(sleeps).toEqual([125, 125]);
  });

  it('fails closed when 50 requests are waiting in the process-local queue', async () => {
    let now = 0;
    let releaseSleep: (() => void) | undefined;
    const limiter = new TikTokAdsRateLimiter({
      now: () => now,
      sleep: (milliseconds) =>
        new Promise<void>((resolve) => {
          releaseSleep = () => {
            now += milliseconds;
            resolve();
          };
        }),
    });
    await limiter.acquire();
    const waiting = Array.from({ length: 50 }, () => limiter.acquire());
    await expect(limiter.acquire()).rejects.toMatchObject({
      code: 'TIKTOK_ADS_RATE_LIMIT_QUEUE_FULL',
    });
    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
      releaseSleep?.();
    }
    await Promise.all(waiting);
  });
});
