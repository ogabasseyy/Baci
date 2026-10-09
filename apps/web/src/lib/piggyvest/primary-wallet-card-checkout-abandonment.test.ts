import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { runPrimaryCardCheckoutAbandonment } from './primary-wallet-card-checkout-abandonment';

function staleIntent(status: 'ready' | 'abandoned' = 'ready') {
  return {
    ...fixture.intent,
    status,
    authorizationUrl: 'https://checkout.paystack.com/fixture123',
    expiresAt: fixture.settings.expiresAt,
    callbackUrl: fixture.settings.callbackUrl,
  };
}

function setup(selected: unknown[], verify: (intent: unknown) => unknown) {
  const execute = vi.fn(
    async (
      action: string,
      _parameters: readonly (string | null)[]
    ): Promise<unknown> => {
      if (action === 'selectStaleReady') return selected;
      return true;
    }
  );
  const provider = { verify: vi.fn(async (intent: unknown) => verify(intent)) };
  return { execute, provider };
}

describe('stale ready checkout abandonment', () => {
  it('abandons only provider-confirmed dead checkouts and collects paid ones', async () => {
    const first = staleIntent();
    const second = {
      ...staleIntent(),
      operationId: '20000000-0000-4000-8000-000000000005',
      reference: 'pvb-first-primary-20000000-0000-4000-8000-000000000005',
    };
    const third = {
      ...staleIntent(),
      operationId: '30000000-0000-4000-8000-000000000005',
      reference: 'pvb-first-primary-30000000-0000-4000-8000-000000000005',
    };
    const collection = {
      reference: second.reference,
      amountKobo: second.amountKobo,
      domain: 'test',
      providerTransactionId: '12345',
      token: null,
    };
    const { execute, provider } = setup(
      [first, second, third],
      (intent: unknown) => {
        const operationId = (intent as { operationId: string }).operationId;
        if (operationId === first.operationId)
          return { outcome: 'abandoned' as const };
        if (operationId === second.operationId)
          return { outcome: 'verified' as const, collection };
        return { outcome: 'pending' as const };
      }
    );
    const totals = await runPrimaryCardCheckoutAbandonment({
      settings: fixture.settings,
      execute: execute as never,
      provider: provider as never,
      now: () => Date.parse('2026-10-09T00:00:00Z'),
    });
    expect(totals).toEqual({
      selected: 3,
      abandoned: 1,
      collected: 1,
      skipped: 1,
    });
    expect(provider.verify).toHaveBeenCalledTimes(3);
    const calls = execute.mock.calls;
    expect(calls[0][0]).toBe('selectStaleReady');
    // 24h default cutoff.
    expect(calls[0][1][1]).toBe('2026-10-08T00:00:00.000Z');
    expect(calls[0][1][2]).toBe('25');
    expect(
      calls.find(
        ([action, params]) =>
          action === 'abandonment' && params[1] === first.operationId
      )
    ).toBeDefined();
    expect(
      calls.find(
        ([action, params]) =>
          action === 'collection' && params[1] === second.operationId
      )
    ).toBeDefined();
    // The pending checkout is never terminalized.
    expect(
      calls.filter(
        ([action, params]) =>
          action !== 'selectStaleReady' && params[1] === third.operationId
      )
    ).toHaveLength(0);
  });
  it('leaves reconciliation_required outcomes for the client/webhook paths', async () => {
    const { execute } = setup([staleIntent()], () => ({
      outcome: 'reconciliation_required' as const,
    }));
    const totals = await runPrimaryCardCheckoutAbandonment({
      settings: fixture.settings,
      execute: execute as never,
      provider: {
        verify: async () => ({ outcome: 'reconciliation_required' as const }),
      } as never,
      now: () => Date.parse('2026-10-09T00:00:00Z'),
    });
    expect(totals).toEqual({
      selected: 1,
      abandoned: 0,
      collected: 0,
      skipped: 1,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects unbounded selection and invalid clocks', async () => {
    const { execute, provider } = setup([], () => ({
      outcome: 'pending' as const,
    }));
    await expect(
      runPrimaryCardCheckoutAbandonment({
        settings: fixture.settings,
        execute: execute as never,
        provider: provider as never,
        maximum: 26,
      })
    ).rejects.toThrow('bounds unavailable');
    await expect(
      runPrimaryCardCheckoutAbandonment({
        settings: fixture.settings,
        execute: execute as never,
        provider: provider as never,
        now: () => Number.NaN,
      })
    ).rejects.toThrow('clock unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
});
