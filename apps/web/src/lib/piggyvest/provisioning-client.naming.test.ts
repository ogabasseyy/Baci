import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./provisioning-store', () => ({
  createPiggyvestProvisioningStore: vi.fn(),
}));

import { provisionPiggyvestStagingResource } from './provisioning-client';
import { createPiggyvestProvisioningStore } from './provisioning-store';
import type { PiggyvestProvisioningIdentity } from './provisioning-store.types';

const configuration = {
  environment: 'staging',
  integrationId: '44444444-4444-4444-8444-444444444444',
  expectedMerchantId: '11111111-1111-4111-8111-111111111111',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: ['22222222-2222-4222-8222-222222222222'],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  defaultInterestRoutingVerified: true,
  fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
  apiSecret: 'synthetic-provider-secret',
  expectedBusinessId: 'synthetic-business',
};
const command = {
  merchantId: configuration.expectedMerchantId,
  customerId: configuration.allowlistedCustomerIds[0],
  kind: 'create_plan_wallet',
  goalId: '33333333-3333-4333-8333-333333333333',
  providerCustomerId: 'synthetic-customer',
  reserveVirtualAccount: true,
  enableInterestAccrual: false,
  interestPayout: 'own_wallet',
  customerName: 'Bassey Effiong',
};
const intentId = '55555555-5555-4555-8555-555555555555';
const legacyFingerprint =
  '90bac45ab94ffcb1a3b6302a5e0e019c83152cc8cd9e600c1268c66c987c0f11';
let fingerprint: string | null;
let status: 'pending' | 'dispatched' | 'unknown' | 'awaiting_confirmation';
const store = { prepare: vi.fn(), claim: vi.fn(), record: vi.fn() };
const fetchImplementation = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ status: true, data: { id: 'synthetic-plan-wallet' } })
);
const run = (changes = {}) =>
  provisionPiggyvestStagingResource({
    configuration,
    command: { ...command, ...changes },
    execute: vi.fn(),
    fetchImplementation,
  });

beforeEach(() => {
  vi.resetAllMocks();
  fingerprint = null;
  status = 'pending';
  store.prepare.mockImplementation(
    async (identity: PiggyvestProvisioningIdentity) => {
      const outcome =
        fingerprint === null
          ? 'accepted'
          : fingerprint === identity.requestFingerprint
            ? 'duplicate'
            : 'conflict';
      fingerprint ??= identity.requestFingerprint;
      return { intentId, outcome, status };
    }
  );
  store.claim.mockImplementation(
    async (_intentId: string, identity: PiggyvestProvisioningIdentity) => {
      if (status !== 'pending' || identity.requestFingerprint !== fingerprint)
        return null;
      status = 'dispatched';
      return '66666666-6666-4666-8666-666666666666';
    }
  );
  store.record.mockImplementation(
    async ({ resultCode }: { resultCode: string }) => {
      status = resultCode === 'accepted' ? 'awaiting_confirmation' : 'unknown';
      return status;
    }
  );
  fetchImplementation.mockImplementation(async () =>
    Response.json({ status: true, data: { id: 'synthetic-plan-wallet' } })
  );
  vi.mocked(createPiggyvestProvisioningStore).mockReturnValue(store);
});

describe('readable wallet names preserve durable provisioning identity', () => {
  it('creates a new wallet using the readable name and never posts again on retry', async () => {
    expect(await run()).toEqual({ status: 'awaiting_confirmation', intentId });
    expect(await run()).toEqual({ status: 'already_dispatched', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body))
        .subaccount_name
    ).toBe('Bassey Effiong Savings D4851B9412725E22');
  });

  it.each([
    'dispatched',
    'unknown',
    'awaiting_confirmation',
  ] as const)('does not recreate an existing legacy %s wallet when a readable name is now supplied', async (storedStatus) => {
    fingerprint = legacyFingerprint;
    status = storedStatus;

    expect(await run()).toEqual({ status: 'already_dispatched', intentId });
    expect(fingerprint).toBe(legacyFingerprint);
    expect(store.prepare).toHaveBeenCalledTimes(2);
    expect(store.claim).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('resumes a legacy pending intent with its original request bytes and fingerprint', async () => {
    fingerprint = legacyFingerprint;

    expect(await run()).toEqual({ status: 'awaiting_confirmation', intentId });
    expect(await run()).toEqual({ status: 'already_dispatched', intentId });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body))
        .subaccount_name
    ).toBe('bacid4851b9412725e22e51c6197d9aa09fb57d36a59');
    expect(store.claim).toHaveBeenCalledWith(
      intentId,
      expect.objectContaining({
        requestFingerprint: legacyFingerprint,
      })
    );
  });

  it.each([
    { enableInterestAccrual: true },
    { reserveVirtualAccount: false },
    { providerCustomerId: 'another-provider-customer' },
  ])('does not use compatibility to bypass a changed financial or ownership choice', async (changes) => {
    fingerprint = legacyFingerprint;

    expect(await run(changes)).toEqual({ status: 'conflict', intentId });
    expect(fingerprint).toBe(legacyFingerprint);
    expect(store.claim).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('allows only one dispatch when concurrent new-name requests race', async () => {
    await Promise.all(Array.from({ length: 8 }, () => run()));

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(status).toBe('awaiting_confirmation');
  });

  it('does not resend an ambiguous new-name request or change its name on retry', async () => {
    fetchImplementation.mockRejectedValueOnce(new Error('synthetic timeout'));

    expect(await run()).toEqual({ status: 'unknown', intentId });
    expect(await run()).toEqual({ status: 'already_dispatched', intentId });
    expect(await run({ customerName: 'Changed Customer' })).toEqual({
      status: 'conflict',
      intentId,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('does not dispatch when reading the legacy intent fails', async () => {
    store.prepare
      .mockResolvedValueOnce({
        intentId,
        outcome: 'conflict',
        status: 'pending',
      })
      .mockRejectedValueOnce(new Error('private database detail'));

    expect(await run()).toEqual({ status: 'storage_unavailable' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { intentId, outcome: 'accepted', status: 'pending' },
    {
      intentId: '77777777-7777-4777-8777-777777777777',
      outcome: 'duplicate',
      status: 'pending',
    },
  ])('refuses compatibility unless the same existing intent matches', async (legacy) => {
    store.prepare
      .mockResolvedValueOnce({
        intentId,
        outcome: 'conflict',
        status: 'pending',
      })
      .mockResolvedValueOnce(legacy);

    expect(await run()).toEqual({ status: 'conflict', intentId });
    expect(store.claim).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
