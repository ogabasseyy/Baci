import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
  MEMORY_COUNTER_MAX_ENTRIES,
} from './request-context';
import {
  DEGRADED_BOOTSTRAP_LIMIT,
  incrementWindowCounter,
  memoryCounters,
} from './request-quota';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

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

  it('keeps bootstrap on the degraded memory budget in production while create fails closed', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    // Bootstrap is a stateless proof mint, so a Redis outage must not
    // blank every shopper's cart at the first step. Create materializes
    // carts from anonymous capabilities, so it stays fail-closed.
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
    ).resolves.toMatchObject({ allowed: false });
  });

  it('grants the full shared bootstrap budget while the store is healthy', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    let count = 0;
    mockGetRedis.mockReturnValue({
      createScript: () => ({
        eval: async () => [++count, 3_600_000],
      }),
    });
    try {
      const input = {
        merchantId: MERCHANT_ID,
        operation: 'bootstrap',
        subject: 'ip-healthy-limit',
      } as const;
      await expect(checkCartQuota(input)).resolves.toMatchObject({
        allowed: true,
        limit: 120,
      });
      count = 119;
      await expect(checkCartQuota(input)).resolves.toMatchObject({
        allowed: true,
        limit: 120,
        remaining: 0,
      });
      await expect(checkCartQuota(input)).resolves.toMatchObject({
        allowed: false,
        limit: 120,
      });
    } finally {
      mockGetRedis.mockReturnValue(null);
    }
  });

  it('grants a reduced per-instance bootstrap limit while degraded', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    // The degraded ceiling is per instance: granting the full shared
    // budget on every instance would multiply the anonymous mint
    // ceiling by the instance count during a Redis outage.
    const input = {
      merchantId: MERCHANT_ID,
      operation: 'bootstrap',
      subject: 'ip-degraded-limit',
    } as const;
    await expect(checkCartQuota(input)).resolves.toMatchObject({
      allowed: true,
      limit: DEGRADED_BOOTSTRAP_LIMIT,
    });
    for (let i = 1; i < DEGRADED_BOOTSTRAP_LIMIT; i++) {
      await checkCartQuota(input);
    }
    await expect(checkCartQuota(input)).resolves.toMatchObject({
      allowed: false,
      limit: DEGRADED_BOOTSTRAP_LIMIT,
      remaining: 0,
    });
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

  it('reserves authenticated fallback capacity from bootstrap churn', async () => {
    __resetCartQuotaStoreForTesting();
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      for (let index = 0; index < MEMORY_COUNTER_MAX_ENTRIES; index++) {
        await checkCartQuota({
          merchantId: MERCHANT_ID,
          operation: 'bootstrap',
          subject: `bootstrap-${index}`,
        });
      }
      // Anonymous bootstrap churn must not consume the fallback budget
      // existing shoppers need to read or update their carts.
      await expect(
        checkCartQuota({
          merchantId: MERCHANT_ID,
          operation: 'snapshot',
          subject: 'existing-shopper',
        })
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        checkCartQuota({
          merchantId: MERCHANT_ID,
          operation: 'commands',
          subject: 'existing-shopper',
        })
      ).resolves.toMatchObject({ allowed: true });
    } finally {
      vi.restoreAllMocks();
    }
  });
});
