import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./provisioning-store', () => ({
  createPiggyvestProvisioningStore: vi.fn(),
}));

import { provisionPiggyvestStagingResource } from './provisioning-client';
import { provisioningClientFixture } from './provisioning-client.fixture';
import { createPiggyvestProvisioningStore } from './provisioning-store';
import { requestPiggyvestStagingJson } from './staging-json-request';

const { intentId, claimToken, configuration, command, accepted } =
  provisioningClientFixture;
const store = { prepare: vi.fn(), claim: vi.fn(), record: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  store.prepare.mockResolvedValue({
    intentId,
    outcome: 'accepted',
    status: 'pending',
  });
  store.claim.mockResolvedValue(claimToken);
  store.record.mockResolvedValue('awaiting_confirmation');
  vi.mocked(createPiggyvestProvisioningStore).mockReturnValue(store);
});

describe('provisionPiggyvestStagingResource', () => {
  it('accepts a documented synthetic customer acknowledgement through the real transport', async () => {
    await expect(
      requestPiggyvestStagingJson({
        configuration: {
          apiSecret: configuration.apiSecret,
          expectedBusinessId: configuration.expectedBusinessId,
        },
        path: '/api/v1/customers',
        method: 'POST',
        body: JSON.stringify({ name: 'Synthetic' }),
        fetchImplementation: vi.fn(async () => Response.json(accepted)),
      })
    ).resolves.toEqual(accepted);
  });
  it('does not POST before both durable prepare and first-dispatch claim resolve', async () => {
    const events: string[] = [];
    store.prepare.mockImplementation(async () => {
      events.push('prepared');
      return { intentId, outcome: 'accepted', status: 'pending' };
    });
    store.claim.mockImplementation(async () => {
      events.push('claimed');
      return claimToken;
    });
    const fetchImplementation = vi.fn(async () => {
      events.push('sent');
      return Response.json(accepted);
    });
    store.record.mockImplementation(async () => {
      events.push('recorded');
      return 'awaiting_confirmation';
    });

    const result = await provisionPiggyvestStagingResource({
      configuration,
      command,
      execute: vi.fn(),
      fetchImplementation,
    });

    expect(result).toEqual({ status: 'awaiting_confirmation', intentId });
    expect(events).toEqual(['prepared', 'claimed', 'sent', 'recorded']);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(store.prepare.mock.calls[0][0]).not.toHaveProperty('body');
    expect(store.record).toHaveBeenCalledWith({
      intentId,
      claimToken,
      resultCode: 'accepted',
      providerCustomerId: 'synthetic-customer',
      providerWalletId: 'synthetic-default-wallet',
      newCustomer: true,
    });
  });

  it.each([
    'prepare',
    'claim',
  ] as const)('does not POST after an uncertain %s commit', async (method) => {
    store[method].mockRejectedValue(
      new Error('synthetic-secret-must-not-leak')
    );
    const fetchImplementation = vi.fn();
    const result = await provisionPiggyvestStagingResource({
      configuration,
      command,
      execute: vi.fn(),
      fetchImplementation,
    });
    expect(result.status).toBe('storage_unavailable');
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'dispatched',
    'unknown',
    'awaiting_confirmation',
  ])('does not resend a %s intent', async (status) => {
    store.prepare.mockResolvedValue({ intentId, outcome: 'duplicate', status });
    const fetchImplementation = vi.fn();
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'already_dispatched', intentId });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });

  it('does not send when a prior intent has different terms', async () => {
    store.prepare.mockResolvedValue({
      intentId,
      outcome: 'conflict',
      status: 'pending',
    });
    const fetchImplementation = vi.fn();
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'conflict', intentId });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not send without the exclusive claim', async () => {
    store.claim.mockResolvedValue(null);
    const fetchImplementation = vi.fn();
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'not_claimed', intentId });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('returns an explicit recoverable outcome for an existing customer without trusting its identifiers', async () => {
    store.record.mockResolvedValue('unknown');
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        ...accepted,
        data: { ...accepted.data, new_customer: false },
      })
    );
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'existing_customer_unowned', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(store.record).toHaveBeenCalledWith({
      intentId,
      claimToken,
      resultCode: 'ambiguous',
      providerCustomerId: null,
      providerWalletId: null,
    });
  });

  it.each([
    { status: false, message: 'synthetic-sensitive-provider-response' },
    { status: true, data: { wallet_id: 'synthetic-wallet' } },
  ])('records malformed or unsuccessful customer responses as unknown without retry', async (body) => {
    store.record.mockResolvedValue('unknown');
    const fetchImplementation = vi.fn(async () => Response.json(body));
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'unknown', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(store.record).toHaveBeenCalledWith({
      intentId,
      claimToken,
      resultCode: 'ambiguous',
      providerCustomerId: null,
      providerWalletId: null,
    });
  });

  it('records a transport failure without treating it as proof that no wallet exists', async () => {
    store.record.mockResolvedValue('unknown');
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error('untrusted transport error'));
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'unknown', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    'stale',
    'reject',
  ])('retains uncertainty after result persistence %s', async (failure) => {
    if (failure === 'reject')
      store.record.mockRejectedValue(new Error('database detail'));
    else store.record.mockResolvedValue('stale');
    const fetchImplementation = vi.fn(async () => Response.json(accepted));
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'unknown', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(store.record).toHaveBeenCalledOnce();
  });

  it('treats wallet HTTP 200 as awaiting confirmation, never as a usable funded wallet', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true, data: { id: 'synthetic-plan-wallet' } })
    );
    expect(
      await provisionPiggyvestStagingResource({
        configuration,
        command: {
          merchantId: command.merchantId,
          customerId: command.customerId,
          kind: 'create_plan_wallet',
          goalId: '33333333-3333-4333-8333-333333333333',
          providerCustomerId: 'synthetic-customer',
          reserveVirtualAccount: true,
          enableInterestAccrual: true,
          interestPayout: 'own_wallet',
        },
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'awaiting_confirmation', intentId });
    expect(store.record.mock.calls[0][0].providerWalletId).toBe(
      'synthetic-plan-wallet'
    );
  });

  it('does not accept an opted-in plan wallet when the provider reports interest disabled', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        status: true,
        data: { id: 'synthetic-plan-wallet', interest_enabled: false },
      })
    );
    const result = await provisionPiggyvestStagingResource({
      configuration,
      command: {
        merchantId: command.merchantId,
        customerId: command.customerId,
        kind: 'create_plan_wallet',
        goalId: '33333333-3333-4333-8333-333333333333',
        providerCustomerId: 'synthetic-customer',
        reserveVirtualAccount: true,
        enableInterestAccrual: true,
        interestPayout: 'own_wallet',
      },
      execute: vi.fn(),
      fetchImplementation,
    });

    expect(result).toEqual({ status: 'unknown', intentId });
    expect(store.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resultCode: 'ambiguous',
        providerCustomerId: null,
        providerWalletId: null,
      })
    );
  });

  it('fails closed before storage or network without owner and isolation gates', async () => {
    const fetchImplementation = vi.fn();
    expect(
      await provisionPiggyvestStagingResource({
        configuration: { ...configuration, provisioningApproved: false },
        command,
        execute: vi.fn(),
        fetchImplementation,
      })
    ).toEqual({ status: 'not_ready' });
    expect(createPiggyvestProvisioningStore).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
