import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
  incrementMemoryCounter,
  MEMORY_COUNTER_MAX_ENTRIES,
} from './request-context';
import { incrementWindowCounter, memoryCounters } from './request-quota';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const OTHER_MERCHANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('checkCartQuota', () => {
  it('allows requests under budget and blocks past exhaustion', async () => {
    __resetCartQuotaStoreForTesting();
    const input = {
      merchantId: MERCHANT_ID,
      operation: 'bootstrap' as const,
      subject: 'ip-1',
    };

    let result = await checkCartQuota(input);
    expect(result.allowed).toBe(true);

    for (let attempt = 1; attempt < result.limit; attempt++) {
      result = await checkCartQuota(input);
      expect(result.allowed).toBe(true);
    }
    result = await checkCartQuota(input);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    __resetCartQuotaStoreForTesting();
  });

  it('gives handoff issue, redeem and preview independent budgets', async () => {
    __resetCartQuotaStoreForTesting();
    const issue = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'handoff_issue',
      subject: 'guest-o1',
    });
    const redeem = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'handoff_redeem',
      subject: 'guest-d1',
    });
    const preview = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'handoff_preview',
      subject: 'ip-9',
    });

    expect(issue.limit).toBeGreaterThan(0);
    expect(issue.remaining).toBe(issue.limit - 1);
    expect(redeem.remaining).toBe(redeem.limit - 1);
    expect(preview.remaining).toBe(preview.limit - 1);
    __resetCartQuotaStoreForTesting();
  });

  it('scopes budgets by merchant, subject and operation', async () => {
    __resetCartQuotaStoreForTesting();
    const first = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a1',
    });
    const otherMerchant = await checkCartQuota({
      merchantId: OTHER_MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a1',
    });
    const otherSubject = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a2',
    });
    const otherOperation = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'snapshot' as const,
      subject: 'guest-a1',
    });

    expect(first.remaining).toBe(first.limit - 1);
    expect(otherMerchant.remaining).toBe(otherMerchant.limit - 1);
    expect(otherSubject.remaining).toBe(otherSubject.limit - 1);
    expect(otherOperation.remaining).toBe(otherOperation.limit - 1);
    __resetCartQuotaStoreForTesting();
  });
});

describe('incrementMemoryCounter store bound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetCartQuotaStoreForTesting();
  });

  it.each([
    'commands',
    'snapshot',
  ] as const)('retains exhausted %s budgets and denies new subjects at capacity', async (operation) => {
    __resetCartQuotaStoreForTesting();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    vi.stubEnv('NODE_ENV', 'production');
    const input = {
      merchantId: MERCHANT_ID,
      operation,
      subject: 'exhausted-principal',
    };
    const first = await checkCartQuota(input);
    for (let attempt = 1; attempt < first.limit; attempt++) {
      await checkCartQuota(input);
    }
    await expect(checkCartQuota(input)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    for (let index = 1; index < MEMORY_COUNTER_MAX_ENTRIES; index++) {
      incrementMemoryCounter(`subject-${index}`, 60_000);
    }
    // Churn must neither evict the exhausted principal nor grow the map.
    for (let index = 0; index < 50; index++) {
      await expect(
        checkCartQuota({ ...input, subject: `overflow-${index}` })
      ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    }
    expect(memoryCounters.size).toBe(MEMORY_COUNTER_MAX_ENTRIES);
    await expect(checkCartQuota(input)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      resetTime: first.resetTime,
    });
    // Existing principals retain availability within their original budget.
    expect(incrementMemoryCounter('subject-1', 60_000).count).toBe(2);
  });
});

// Counter-machinery coverage (window counter, degradation warning,
// PTTL expiry, memory-store bounds) lives in the colocated
// request-quota-counter.test.ts suite.
