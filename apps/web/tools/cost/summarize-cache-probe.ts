import { createHash } from 'node:crypto';
import type { CacheProbeMetrics } from './measure-vercel-storefront-cost-types';
import { readBoundedJsonl } from './read-bounded-jsonl';

const CACHE_HIT_STATUSES = new Set(['HIT', 'PRERENDER', 'STALE']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNonnegative(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    throw new Error(`cache probe row has an invalid ${field}`);
  return value;
}

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Summarizes sampled cache status and TTFB rows without exposing raw data. */
export async function summarizeCacheProbe(
  path: string
): Promise<CacheProbeMetrics> {
  const { bytes, rows } = await readBoundedJsonl(path, 'cache probe');
  let cacheStatusRows = 0;
  let cacheHitRows = 0;
  const ttfbValues: number[] = [];
  for (const candidate of rows) {
    if (!isRecord(candidate))
      throw new Error('cache probe row is not an object');
    if (candidate.cacheStatus !== undefined && candidate.cacheStatus !== null) {
      if (typeof candidate.cacheStatus !== 'string') {
        throw new Error('cache probe row has a non-string cacheStatus');
      }
      cacheStatusRows += 1;
      if (CACHE_HIT_STATUSES.has(candidate.cacheStatus.trim().toUpperCase())) {
        cacheHitRows += 1;
      }
    }
    if (candidate.ttfbMs !== null && candidate.ttfbMs !== undefined)
      ttfbValues.push(finiteNonnegative(candidate.ttfbMs, 'ttfbMs'));
  }
  return {
    cacheStatusRows,
    cacheHitRows,
    cacheHitRatio:
      cacheStatusRows === 0 ? null : cacheHitRows / cacheStatusRows,
    p50TtfbMs: percentile(ttfbValues, 0.5),
    p95TtfbMs: percentile(ttfbValues, 0.95),
    rows: rows.length,
    sourceSha256: sha256(bytes),
  };
}
