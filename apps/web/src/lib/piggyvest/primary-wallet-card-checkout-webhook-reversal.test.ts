import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { reconcilePrimaryWalletCardCheckoutReversal } from './primary-wallet-card-checkout-webhook-reversal';

vi.mock('server-only', () => ({}));

// Paystack's documented refund shape: no metadata, no id, no
// reference — the original charge reference in
// transaction_reference, the refund's own identity in
// refund_reference, and the amount as a decimal kobo string.
function body(overrides: Record<string, unknown> = {}) {
  return {
    event: 'refund.processed',
    data: {
      status: 'processed',
      transaction_reference: fixture.intent.reference,
      refund_reference: 'rtn-25431-xyz',
      amount: '25000',
      currency: 'NGN',
      ...overrides,
    },
  };
}

// Disputes identify with the numeric/string dispute id (not the
// refund's refund_reference); the charge reference rides along for
// the operation tail.
function disputeBody(overrides: Record<string, unknown> = {}) {
  return body({ id: 7654321, ...overrides });
}

function setup(status = 'completed') {
  const execute = vi.fn(
    async (action: string, _params?: readonly string[]): Promise<unknown> => {
      if (action === 'reversal_intent') return { ...fixture.intent, status };
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

  it('derives the operation from the reference without webhook metadata', async () => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: body(),
      runtime,
      execute: execute as never,
    });
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'reversal_intent',
      'reversal',
    ]);
    expect(execute.mock.calls[0]?.[1]).toEqual([fixture.intent.reference]);
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(reversalParams[1]).toBe(fixture.intent.operationId);
    expect(reversalParams[2]).toBe('refund');
    expect(reversalParams[3]).toBe('rtn-25431-xyz');
    expect(JSON.parse(reversalParams[4] ?? '{}')).toMatchObject({
      amountKobo: 25000,
      currency: 'NGN',
    });
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ received: true });
  });

  it('rejects a reference that names no checkout instead of recording', async () => {
    const { execute, runtime } = setup();
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body({
          transaction_reference: 'WAL-unrelated-reference',
        }),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps retryable when present metadata contradicts the reference', async () => {
    const { execute, runtime } = setup();
    const payload = body();
    (payload.data as Record<string, unknown>).metadata = {
      operation_id: '20000000-0000-4000-8000-000000000005',
    };
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: payload,
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts agreeing metadata as a cross-check', async () => {
    const { execute, runtime } = setup('completed');
    const payload = body();
    (payload.data as Record<string, unknown>).metadata = {
      operation_id: fixture.intent.operationId,
    };
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: payload,
      runtime,
      execute: execute as never,
    });
    expect(response?.status).toBe(200);
  });

  it('refuses a stored intent from another deployment', async () => {
    const { execute, runtime } = setup('completed');
    execute.mockImplementation(async (action: string): Promise<unknown> => {
      if (action === 'reversal_intent')
        return {
          ...fixture.intent,
          status: 'completed',
          merchantId: '20000000-0000-4000-8000-000000000001',
        };
      throw new Error('Invalid test action');
    });
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body(),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'reversal_intent',
    ]);
  });

  it('records disputes with the dispute kind', async () => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: { ...disputeBody(), event: 'charge.dispute.create' },
      runtime,
      execute: execute as never,
    });
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(reversalParams[2]).toBe('dispute');
    expect(response?.status).toBe(200);
  });

  it.each([
    { resolution: 'declined', status: 'resolved', expected: 'won' },
    { resolution: 'merchant-accepted', status: 'resolved', expected: 'lost' },
  ])('records dispute resolutions with outcome $expected', async ({
    resolution,
    status,
    expected,
  }) => {
    const { execute, runtime } = setup('completed');
    const payload = disputeBody();
    const data = payload.data as Record<string, unknown>;
    delete data.transaction_reference;
    data.transaction_ref = fixture.intent.reference;
    data.status = status;
    (data as Record<string, unknown>).resolution = resolution;
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: { ...payload, event: 'charge.dispute.resolve' },
      runtime,
      execute: execute as never,
    });
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(reversalParams[2]).toBe('dispute');
    expect(JSON.parse(reversalParams[4] ?? '{}')).toMatchObject({
      event: 'charge.dispute.resolve',
      resolution: expected,
    });
    expect(response?.status).toBe(200);
  });

  it('leaves ambiguous resolutions unset so the fence holds', async () => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: {
        ...disputeBody(),
        event: 'charge.dispute.resolve',
        data: {
          ...(disputeBody().data as Record<string, unknown>),
          status: 'pending',
        },
      },
      runtime,
      execute: execute as never,
    });
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(JSON.parse(reversalParams[4] ?? '{}')).toMatchObject({
      resolution: null,
    });
    expect(response?.status).toBe(200);
  });

  it('resolves the original reference from nested dispute payloads', async () => {
    const { execute, runtime } = setup('completed');
    const payload = disputeBody();
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
      'reversal_intent',
      'reversal',
    ]);
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

  it('stays retryable when the reversal write fails instead of losing money-out evidence', async () => {
    const { execute, runtime } = setup('completed');
    execute.mockImplementation(async (action: string): Promise<unknown> => {
      if (action === 'reversal_intent')
        return { ...fixture.intent, status: 'completed' };
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

  it('stays retryable when the intent lookup fails instead of acking', async () => {
    const { execute, runtime } = setup('completed');
    execute.mockRejectedValue(new Error('private storage failure'));
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body(),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
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

  it.each([
    { refund_reference: null },
    { refund_reference: '' },
  ])('stays retryable when a processed refund names no refund reference: %j', async (change) => {
    const { execute, runtime } = setup('completed');
    expect(
      await reconcilePrimaryWalletCardCheckoutReversal({
        body: body(change),
        runtime,
        execute: execute as never,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    '10.5',
    '-3',
    '',
    '25,000',
  ])('records a refund with an unreadable amount as null instead of misreading it: %s', async (amount) => {
    const { execute, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutReversal({
      body: body({ amount }),
      runtime,
      execute: execute as never,
    });
    expect(response?.status).toBe(200);
    const reversalParams = (execute.mock.calls[1]?.[1] ?? []) as string[];
    expect(JSON.parse(reversalParams[4] ?? '{}')).toMatchObject({
      amountKobo: null,
    });
  });
});
