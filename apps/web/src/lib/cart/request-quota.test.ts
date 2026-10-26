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
    // Handoff redemption materializes grants from anonymous
    // capabilities, so it fails closed too.
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

  it('keeps bootstrap and create on the degraded memory budget in production', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    // A Redis outage must not blank every shopper's cart: bootstrap is
    // a stateless proof mint and create is bounded by its database
    // operation receipt, so both degrade like authenticated reads.
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'create',
        subject: 'ip-degraded',
      })
    ).resolves.toMatchObject({ allowed: true });
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
          operation: 'handoff_preview',
          subject: 'ip-malformed',
        })
      ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    } finally {
      mockGetRedis.mockReturnValue(null);
    }
  });

  it('reserves fallback capacity for shopper operations when production denies anonymous churn', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    for (let index = 0; index <= MEMORY_COUNTER_MAX_ENTRIES; index++) {
      for (const operation of ['handoff_redeem', 'account_link'] as const) {
        await expect(
          checkCartQuota({
            merchantId: MERCHANT_ID,
            operation,
            subject: `denied-${index}`,
          })
        ).resolves.toMatchObject({ allowed: false, remaining: 0 });
      }
    }
    expect(memoryCounters.size).toBe(0);
    for (const operation of ['snapshot', 'commands'] as const) {
      await expect(
        checkCartQuota({
          merchantId: MERCHANT_ID,
          operation,
          subject: 'shopper',
        })
      ).resolves.toMatchObject({ allowed: true, remaining: 239 });
    }
    expect(memoryCounters.size).toBe(2);
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

  it('admits new subjects after expired windows release capacity', () => {
    __resetCartQuotaStoreForTesting();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    for (let index = 0; index < MEMORY_COUNTER_MAX_ENTRIES; index++) {
      incrementMemoryCounter(`subject-${index}`, 60_000);
    }
    expect(incrementMemoryCounter('new-subject', 60_000).count).toBe(
      Number.POSITIVE_INFINITY
    );
    now.mockReturnValue(1_060_001);
    expect(incrementMemoryCounter('new-subject', 60_000).count).toBe(1);
    expect(memoryCounters.size).toBe(1);
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
