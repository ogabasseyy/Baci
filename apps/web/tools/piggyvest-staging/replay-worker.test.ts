import { describe, expect, it, vi } from 'vitest';
import { adapters, key, lease, secondLease } from './replay-test-fixtures';
import type { ReplayAdapters } from './replay-worker';
import { createReplayWorker, DispatchQuarantine } from './replay-worker';

describe('bounded staging replay worker', () => {
  it('rejects non-staging activation before claiming durable work', async () => {
    const deps = adapters();
    expect(() =>
      createReplayWorker(deps, {
        environment: 'production',
        batchSize: 1,
        keyResolver: async () => key,
      })
    ).toThrow();
    expect(deps.claimBatch).not.toHaveBeenCalled();
  });

  it('requires exact pvb_wallet mapping and does not use nested destination as attribution', async () => {
    const deps = adapters();
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.processed).toBe(1);
    expect(deps.resolveMapping).toHaveBeenCalledWith({
      providerCustomerId: 'provider-customer-001',
      pvbWallet: 'api-wallet-001',
    });
    expect(deps.dispatch).toHaveBeenCalledOnce();
  });

  it.each([
    ['ambiguous', { status: 'ambiguous' as const }],
    [
      'mismatch',
      {
        status: 'matched' as const,
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'other-provider',
          pvbWallet: 'api-wallet-001',
        },
      },
    ],
  ])('quarantines %s mapping results without dispatch', async (_name, resolution) => {
    const deps = adapters({ resolveMapping: vi.fn(async () => resolution) });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.quarantined).toBe(1);
    expect(deps.quarantine).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: 'claim-001',
        reason: expect.stringMatching(/mapping/),
      })
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('marks unmapped work retryable and does not lose it', async () => {
    const deps = adapters({
      resolveMapping: vi.fn(async () => ({ status: 'unmapped' as const })),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(deps.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retryable',
        reason: 'mapping-unavailable',
      })
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('resolves a duplicate dispatch as processed without treating generic processor text as proof', async () => {
    const deps = adapters({
      dispatch: vi.fn(async () => 'duplicate' as const),
    });
    await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(deps.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', reason: 'duplicate' })
    );
  });

  it('retries an unexpected dispatch outcome instead of treating it as applied', async () => {
    const deps = adapters({
      dispatch: vi.fn(
        async () =>
          'processed' as unknown as Awaited<
            ReturnType<ReplayAdapters['dispatch']>
          >
      ),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(deps.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retryable',
        reason: 'invalid-dispatch-outcome',
      })
    );
  });

  it('retries a missing key and keeps processing later leases', async () => {
    const deps = adapters({
      claimBatch: vi.fn(async () => [lease(), secondLease()]),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 2,
      keyResolver: async () => null,
    }).run();
    expect(result.retryable).toBe(2);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('contains key and mapping resolver failures to one lease', async () => {
    const keyDeps = adapters({
      claimBatch: vi.fn(async () => [lease(), secondLease()]),
    });
    let keyCalls = 0;
    const keyResult = await createReplayWorker(keyDeps, {
      environment: 'staging',
      batchSize: 2,
      keyResolver: async () => {
        keyCalls += 1;
        if (keyCalls === 1) throw new Error('secret');
        return key;
      },
    }).run();
    expect(keyResult.retryable).toBe(1);
    expect(keyResult.processed).toBe(1);

    const mappingDeps = adapters({
      claimBatch: vi.fn(async () => [lease(), secondLease()]),
    });
    let mappingCalls = 0;
    const mappingResult = await createReplayWorker(mappingDeps, {
      environment: 'staging',
      batchSize: 2,
      keyResolver: async () => key,
    });
    mappingDeps.resolveMapping = vi.fn(async () => {
      mappingCalls += 1;
      if (mappingCalls === 1) throw new Error('provider body');
      return {
        status: 'matched' as const,
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      };
    });
    const mappingResultValue = await mappingResult.run();
    expect(mappingResultValue.retryable).toBe(1);
    expect(mappingResultValue.processed).toBe(1);
  });

  it('retries a malformed mapping result and continues with the next lease', async () => {
    const deps = adapters({
      claimBatch: vi.fn(async () => [lease(), secondLease()]),
    });
    let mappingCalls = 0;
    deps.resolveMapping = vi.fn(async () => {
      mappingCalls += 1;
      if (mappingCalls === 1) {
        return undefined as unknown as Awaited<
          ReturnType<ReplayAdapters['resolveMapping']>
        >;
      }
      return {
        status: 'matched' as const,
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      };
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 2,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(result.processed).toBe(1);
    expect(deps.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retryable',
        reason: 'invalid-mapping-result',
      })
    );
  });

  it('fails closed before dispatch when claim returns more than the bound', async () => {
    const deps = adapters({
      claimBatch: vi.fn(async () => [lease(), secondLease()]),
    });
    await expect(
      createReplayWorker(deps, {
        environment: 'staging',
        batchSize: 1,
        keyResolver: async () => key,
      }).run()
    ).rejects.toThrow('Replay claim exceeded configured bound');
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('quarantines DispatchQuarantine instead of resolving retryable', async () => {
    const deps = adapters({
      dispatch: vi.fn(async () => {
        throw new DispatchQuarantine({
          eventId: 'evt-worker-001',
          reason: 'poison',
        });
      }),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.quarantined).toBe(1);
    expect(result.retryable).toBe(0);
    expect(deps.quarantine).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptId: 'receipt-001',
        eventId: 'evt-worker-001',
        claimToken: 'claim-001',
        reason: 'poison',
      })
    );
    expect(deps.resolve).not.toHaveBeenCalled();
  });

  it('quarantines leases whose id does not bind to the sealed event', async () => {
    const swapped = { ...lease(), eventId: 'evt-someone-else' };
    const deps = adapters({
      claimBatch: vi.fn(async () => [swapped]),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.quarantined).toBe(1);
    expect(result.processed).toBe(0);
    expect(deps.quarantine).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'event-id-mismatch' })
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('retries a dispatch failure and leaves a crash before resolve lease-fenced', async () => {
    const deps = adapters({
      dispatch: vi.fn(async () => {
        throw new Error('provider body secret');
      }),
    });
    const result = await createReplayWorker(deps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(deps.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retryable',
        reason: 'dispatch-failed',
      })
    );
    const crashDeps = adapters({
      resolve: vi.fn(async () => {
        throw new Error('lease lost');
      }),
    });
    const crashResult = await createReplayWorker(crashDeps, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(crashResult.resolutionFailures).toBe(1);
    expect(crashDeps.dispatch).toHaveBeenCalledOnce();
  });
});
