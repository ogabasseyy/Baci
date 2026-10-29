type QuotaDenial = {
  operation: 'bootstrap' | 'create' | 'handoff_preview';
  identity:
    | 'credential'
    | 'missing_credential'
    | 'invalid_credential'
    | 'network_backstop';
  scope: 'pre_resolution' | 'merchant';
  degraded: boolean;
};

type Bucket = { pending: number; threshold: number; deadline: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_THRESHOLD = 2 ** 20;

/** Aggregate repeat denials without storing an identifier or logging each request. */
export function recordQuotaDenial(event: QuotaDenial): void {
  const key = `${event.operation}:${event.identity}:${event.scope}:${event.degraded}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? {
    pending: 0,
    threshold: 1,
    deadline: now + WINDOW_MS,
  };
  bucket.pending += 1;
  const elapsed = now >= bucket.deadline;
  if (elapsed || bucket.pending >= bucket.threshold) {
    console.info('Cart quota denied', {
      ...event,
      occurrences: bucket.pending,
    });
    bucket.pending = 0;
    bucket.threshold = elapsed
      ? 1
      : Math.min(bucket.threshold * 2, MAX_THRESHOLD);
    if (elapsed) bucket.deadline = now + WINDOW_MS;
  }
  buckets.set(key, bucket);
}

export function __resetQuotaDenialTelemetryForTesting(): void {
  buckets.clear();
}
