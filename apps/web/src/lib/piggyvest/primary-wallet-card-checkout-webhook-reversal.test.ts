import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { reconcilePrimaryWalletCardCheckoutReversal } from './primary-wallet-card-checkout-webhook-reversal';

vi.mock('server-only', () => ({}));

function body(overrides: Record<string, unknown> = {}) {
  return {
    event: 'refund.processed',
    data: {
      id: 1234567,
      amount: 25000,
      currency: 'NGN',
      status: 'processed',
      transaction_reference: fixture.intent.reference,
      reference: 'rtn-refund-event-id',
      metadata: {
        transaction_type: 'primary_wallet_card_checkout',
        operation_id: fixture.intent.operationId,
        integration_id: fixture.settings.integrationId,
        merchant_id: fixture.settings.merchantId,
        customer_id: '10000000-0000-4000-8000-000000000002',
        user_id: '10000000-0000-4000-8000-000000000003',
        environment: 'staging',
      },
      ...overrides,
    },
  };
}

function setup(status = 'completed') {
  const execute = vi.fn(
    async (action: string, _params?: readonly string[]): Promise<unknown> => {
      if (action === 'read') return { ...fixture.intent, status };
      if (action === 'reversal') return { outcome: 'recorded' };
      throw new Error(`Invalid test action ${action}`);
    }
  );
  const runtime = { settings: fixture.settings };
  return { execute, runtime };
}

describe('primary card checkout webhook reversal', () => {
  it('ignores non-reversal events without touching storage', async () => {
    const { execute, runtime } = setup();
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: { ...body(), event: 'charge.success' },
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a metadata operation ID that does not match the original transaction reference', async () => {
    const { execute, runtime } = setup();
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body({
          transaction_reference:
            'pvb-first-primary-20000000-0000-4000-8000-000000000005',
        }),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('reads the stored intent and records the reversal before acknowledging', async () => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: body(),
      runtime,
      execute: execute as never,
    });
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'read',
      'reversal',
    ]);
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(reversalParams[1]).toBe(fixture.intent.operationId);
    expect(reversalParams[2]).toBe('refund');
    expect(reversalParams[3]).toBe('1234567');
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ received: true });
  });

  it('records disputes with the dispute kind', async () => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: { ...body(), event: 'charge.dispute.create' },
      runtime,
      execute: execute as never,
    });
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(reversalParams[2]).toBe('dispute');
    expect(response?.status).toBe(200);
  });

  it('coerces absent informational fields to null instead of dropping authentic events', async () => {
    const { execute, runtime } = setup('completed');
    const payload = body({ amount: undefined, currency: undefined });
    delete (payload.data as Record<string, unknown>).amount;
    delete (payload.data as Record<string, unknown>).currency;
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: payload,
      runtime,
      execute: execute as never,
    });
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(JSON.parse(reversalParams[4] ?? '{}')).toMatchObject({
      amountKobo: null,
      currency: null,
    });
    expect(response?.status).toBe(200);
  });

  it('resolves the original reference from nested dispute payloads', async () => {
    const { execute, runtime } = setup('completed');
    const payload = body();
    delete (payload.data as Record<string, unknown>).transaction_reference;
    (payload.data as Record<string, unknown>).transaction = {
      reference: fixture.intent.reference,
    };
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: { ...payload, event: 'charge.dispute.create' },
      runtime,
      execute: execute as never,
    });
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'read',
      'reversal',
    ]);
    expect(response?.status).toBe(200);
  });

  it('stays retryable when the reversal write fails instead of losing money-out evidence', async () => {
    const { execute, runtime } = setup('completed');
    execute.mockImplementation(async (action: string): Promise<unknown> => {
      if (action === 'read') return { ...fixture.intent, status: 'completed' };
      throw new Error('private storage failure');
    });
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body(),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
  });

  it('stays retryable when the scope disagrees instead of acks', async () => {
    const { execute, runtime } = setup('completed');
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body({ metadata: undefined }),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not read storage for unshaped deliveries', async () => {
    const { execute, runtime } = setup('completed');
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: { event: 'refund.processed', data: { id: 1 } },
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
