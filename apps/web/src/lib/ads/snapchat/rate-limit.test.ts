import { describe, expect, it } from 'vitest';
import { SnapchatAdsRateLimiter } from './rate-limit';

describe('Snapchat Ads rate limiter', () => {
  it('spaces consecutive token requests below the documented limit', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new SnapchatAdsRateLimiter(
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      }
    );
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([125]);
  });

  it('fails closed when 50 requests are waiting in the process-local queue', async () => {
    let now = 0;
    let releaseSleep: (() => void) | undefined;
    const limiter = new SnapchatAdsRateLimiter(
      () => now,
      (milliseconds) =>
        new Promise<void>((resolve) => {
          releaseSleep = () => {
            now += milliseconds;
            resolve();
          };
        })
    );
    await limiter.acquire();
    const waiting = Array.from({ length: 50 }, () => limiter.acquire());

    await expect(limiter.acquire()).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_RATE_LIMIT_QUEUE_FULL',
    });

    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
      releaseSleep?.();
    }
    await Promise.all(waiting);
  });
});
