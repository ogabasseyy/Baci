import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { reconcilePrimaryWalletCardCheckoutWebhook } from './primary-wallet-card-checkout-webhook-reconcile';

vi.mock('server-only', () => ({}));

function body(overrides: Record<string, unknown> = {}) {
  return {
    event: 'charge.success',
    data: {
      reference: fixture.intent.reference,
      customer: { email: 'customer@example.test' },
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

function setup(status = 'ready') {
  let intent = { ...fixture.intent, status };
  const execute = vi.fn(async (action: string): Promise<unknown> => {
    if (action === 'read') return intent;
    if (action === 'collection') {
      intent = { ...intent, status: 'custody_pending' };
      return true;
    }
    if (action === 'reconciliation') {
      intent = { ...intent, status: 'reconciliation_required' };
      return true;
    }
    throw new Error(`Invalid test action ${action}`);
  });
  const provider = {
    initialize: vi.fn(),
    verify: vi.fn().mockResolvedValue({
      outcome: 'verified',
      collection: {
        reference: fixture.intent.reference,
        amountKobo: 25000,
        domain: 'test',
        providerTransactionId: '12345',
        token: null,
      },
    }),
  };
  const runtime = { settings: fixture.settings };
  return { execute, provider, runtime };
}

describe('primary card checkout webhook reconcile', () => {
  it('verifies and durably records a charged collection before acknowledging', async () => {
    const { execute, provider, runtime } = setup('ready');
    const response = await reconcilePrimaryWalletCardCheckoutWebhook({
      body: body(),
      runtime,
      execute: execute as never,
      provider: provider as never,
    });
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'read',
      'collection',
      'read',
    ]);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ received: true });
  });

  it('acknowledges already-terminal receipts without re-verifying', async () => {
    const { execute, provider, runtime } = setup('completed');
    const response = await reconcilePrimaryWalletCardCheckoutWebhook({
      body: body(),
      runtime,
      execute: execute as never,
      provider: provider as never,
    });
    expect(provider.verify).not.toHaveBeenCalled();
    expect(response?.status).toBe(200);
  });

  it('keeps pending charges retryable instead of acknowledging', async () => {
    const { execute, provider, runtime } = setup('ready');
    provider.verify.mockResolvedValue({ outcome: 'pending' });
    expect(
      await reconcilePrimaryWalletCardCheckoutWebhook({
        body: body(),
        runtime,
        execute: execute as never,
        provider: provider as never,
      })
    ).toBeNull();
    expect(execute.mock.calls.map(([action]) => action)).toEqual(['read']);
  });

  it('durably flags mismatched charges before acknowledging', async () => {
    const { execute, provider, runtime } = setup('ready');
    provider.verify.mockResolvedValue({ outcome: 'reconciliation_required' });
    const response = await reconcilePrimaryWalletCardCheckoutWebhook({
      body: body(),
      runtime,
      execute: execute as never,
      provider: provider as never,
    });
    expect(execute.mock.calls.map(([action]) => action)).toContain(
      'reconciliation'
    );
    expect(response?.status).toBe(200);
  });

  it.each([
    ['missing operation', { metadata: { transaction_type: 'primary_wallet_card_checkout' } }],
    ['mismatched reference', { reference: 'pvb-first-primary-00000000-0000-4000-8000-000000000000' }],
    ['missing customer email', { customer: {} }],
  ])('stays retryable on %s', async (_label, overrides) => {
    const { execute, provider, runtime } = setup('ready');
    expect(
      await reconcilePrimaryWalletCardCheckoutWebhook({
        body: body(overrides),
        runtime,
        execute: execute as never,
        provider: provider as never,
      })
    ).toBeNull();
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it('stays retryable when the runtime is unconfigured or the scope disagrees', async () => {
    const { execute, provider, runtime } = setup('ready');
    expect(
      await reconcilePrimaryWalletCardCheckoutWebhook({
        body: body(),
        runtime: null,
        execute: execute as never,
        provider: provider as never,
      })
    ).toBeNull();
    const foreign = body();
    (
      foreign.data.metadata as Record<string, unknown>
    ).merchant_id = '00000000-0000-4000-8000-000000000099';
    expect(
      await reconcilePrimaryWalletCardCheckoutWebhook({
        body: foreign,
        runtime,
        execute: execute as never,
        provider: provider as never,
      })
    ).toBeNull();
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it('stays retryable when the stored identity disagrees with the webhook', async () => {
    const { execute, provider, runtime } = setup('ready');
    const foreign = body({ customer: { email: 'someone-else@example.test' } });
    expect(
      await reconcilePrimaryWalletCardCheckoutWebhook({
        body: foreign,
        runtime,
        execute: execute as never,
        provider: provider as never,
      })
    ).toBeNull();
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
