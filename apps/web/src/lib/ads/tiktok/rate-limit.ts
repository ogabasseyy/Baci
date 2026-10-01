import 'server-only';

export class TikTokAdsRateLimitError extends Error {
  readonly code = 'TIKTOK_ADS_RATE_LIMIT_QUEUE_FULL';

  constructor() {
    super('TIKTOK_ADS_RATE_LIMIT_QUEUE_FULL');
    this.name = 'TikTokAdsRateLimitError';
  }
}

interface TikTokAdsRateLimiterDependencies {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * A deliberately conservative, per-process safety gate: one request every
 * 125 ms (8 QPS / 480 QPM), below TikTok Basic's 10 QPS / 600 QPM limits.
 * It is not a durable distributed queue, so enabling multi-instance sync
 * workers still requires a queue-owned global limiter.
 */
export class TikTokAdsRateLimiter {
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private nextAllowedAt = 0;
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(dependencies: TikTokAdsRateLimiterDependencies = {}) {
    this.now = dependencies.now ?? Date.now;
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async acquire(): Promise<void> {
    if (this.pending >= 50) throw new TikTokAdsRateLimitError();
    this.pending += 1;
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + 125;
    } finally {
      this.pending -= 1;
      release();
    }
  }
}

export const tiktokAdsProviderRateLimiter = new TikTokAdsRateLimiter();
