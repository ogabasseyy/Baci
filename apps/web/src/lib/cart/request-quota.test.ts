import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
  incrementMemoryCounter,
  MEMORY_COUNTER_MAX_ENTRIES,
} from './request-context';
import { incrementWindowCounter } from './request-quota';

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

describe('checkCartQuota degraded store', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetCartQuotaStoreForTesting();
  });

  it('fails closed for unauthenticated operations in production without Redis', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'handoff_preview',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false });
    // Cart creation and handoff redemption materialize carts/grants
    // from anonymous capabilities, so they fail closed too.
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'create',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'handoff_redeem',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false });
    // Credential-minting and account-linking fail closed too.
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'account_link',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'handoff_issue',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: false });
  });

  it('fails revocation closed in production without Redis', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    // Revocation verifies credential material (including expired
    // proofs inside their grace window), so a degraded quota store
    // must not reopen an unbudgeted revocation path.
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'session_revoke',
        subject: 'principal-degraded',
      })
    ).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('fails the legacy bridge closed in production without Redis', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    // Server-to-server bridge traffic can retry after the outage;
    // a degraded per-instance budget must not multiply its limits.
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'legacy_bridge',
        subject: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false });
  });

  it('degrades on an impossible zero counter or scalar reply', async () => {
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => [0, 5_000] }),
    });
    await expect(
      incrementWindowCounter('quota:zero', 60_000)
    ).resolves.toMatchObject({ degraded: true });
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => 3 }),
    });
    await expect(
      incrementWindowCounter('quota:scalar', 60_000)
    ).resolves.toMatchObject({ degraded: true });
    mockGetRedis.mockReturnValue(null);
  });

  it('fails closed when the Redis reply is malformed but does not throw', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => ['not-a-number', 5_000] }),
    });
    try {
      const counter = await incrementWindowCounter('quota:malformed', 60_000);
      expect(counter.degraded).toBe(true);
      await expect(
        checkCartQuota({
          merchantId: MERCHANT_ID,
          operation: 'bootstrap',
          subject: 'ip-malformed',
        })
      ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    } finally {
      mockGetRedis.mockReturnValue(null);
    }
  });

  it('keeps authenticated operations on the degraded memory budget', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'commands',
        subject: 'principal-degraded',
      })
    ).resolves.toMatchObject({ allowed: true });
  });
});

describe('incrementMemoryCounter store bound', () => {
  it('evicts entries once the degraded store exceeds its bound', () => {
    __resetCartQuotaStoreForTesting();
    // Fill past the bound with distinct per-principal subjects.
    for (let index = 0; index < MEMORY_COUNTER_MAX_ENTRIES + 50; index++) {
      incrementMemoryCounter(`subject-${index}`, 60_000);
    }
    // The earliest subjects were evicted: counting one again restarts
    // its window instead of continuing it.
    expect(incrementMemoryCounter('subject-0', 60_000).count).toBe(1);
    // A subject still inside the bound keeps its count.
    const recent = `subject-${MEMORY_COUNTER_MAX_ENTRIES + 49}`;
    expect(incrementMemoryCounter(recent, 60_000).count).toBe(2);
  });
});

describe('quota degradation warning', () => {
  it('warns while degraded, throttled to once a minute', async () => {
    __resetCartQuotaStoreForTesting();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      await checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'warn-1',
      });
      const afterFirst = warn.mock.calls.length;
      expect(afterFirst).toBeGreaterThanOrEqual(1);

      // Still degraded a few seconds later: no second warning.
      now.mockReturnValue(1_030_000);
      await checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'warn-1',
      });
      expect(warn.mock.calls.length).toBe(afterFirst);

      // A minute later the degradation is reported again.
      now.mockReturnValue(1_061_000);
      await checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'warn-1',
      });
      expect(warn.mock.calls.length).toBe(afterFirst + 1);
    } finally {
      warn.mockRestore();
      now.mockRestore();
      __resetCartQuotaStoreForTesting();
    }
  });

  it('reports the Redis window expiry from PTTL, not now + window', async () => {
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => [3, 5_000] }),
    });
    const before = Date.now();
    const result = await incrementWindowCounter('quota:test', 3_600_000);
    const after = Date.now();
    expect(result).toMatchObject({ count: 3, degraded: false });
    expect(result.resetTime).toBeGreaterThanOrEqual(before + 5_000);
    expect(result.resetTime).toBeLessThanOrEqual(after + 5_000);
    mockGetRedis.mockReturnValue(null);
  });
});
