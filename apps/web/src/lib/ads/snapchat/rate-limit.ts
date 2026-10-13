import 'server-only';

export class SnapchatAdsRateLimitError extends Error {
  readonly code = 'SNAPCHAT_ADS_RATE_LIMIT_QUEUE_FULL';

  constructor() {
    super('SNAPCHAT_ADS_RATE_LIMIT_QUEUE_FULL');
    this.name = 'SnapchatAdsRateLimitError';
  }
}

export class SnapchatAdsRateLimiter {
  private nextAllowedAt = 0;
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}
  async acquire(): Promise<void> {
    if (this.pending >= 50) throw new SnapchatAdsRateLimitError();
    this.pending += 1;
    const prior = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    try {
      await prior;
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay) await this.sleep(delay);
      // 8 QPS stays below Snap's documented 10 QPS per access-token limit.
      this.nextAllowedAt = this.now() + 125;
    } finally {
      this.pending -= 1;
      release();
    }
  }
}
export const snapchatAdsProviderRateLimiter = new SnapchatAdsRateLimiter();
