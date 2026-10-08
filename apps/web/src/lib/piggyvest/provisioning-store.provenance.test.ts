import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestProvisioningStore } from './provisioning-store';

vi.mock('server-only', () => ({}));

describe('new-customer provenance recording', () => {
  const configuration = {
    environment: 'staging',
    integrationId: '44444444-4444-4444-8444-444444444444',
    expectedMerchantId: '11111111-1111-4111-8111-111111111111',
    expectedBusinessId: 'synthetic-business',
  };
  const input = {
    intentId: '55555555-5555-4555-8555-555555555555',
    claimToken: '66666666-6666-4666-8666-666666666666',
    resultCode: 'accepted' as const,
    providerCustomerId: 'synthetic-customer',
    providerWalletId: 'synthetic-wallet',
    newCustomer: true as const,
  };
  it('records a fresh acknowledgement and immutable provenance atomically through the dedicated RPC', async () => {
    const execute = vi.fn(async () => ({
      rows: [{ outcome: 'awaiting_confirmation' }],
    }));
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    expect(await store.record(input)).toBe('awaiting_confirmation');
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT piggyvest_staging.record_created_customer($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::text) AS outcome',
      [
        configuration.integrationId,
        configuration.expectedMerchantId,
        input.intentId,
        input.claimToken,
        configuration.expectedBusinessId,
        input.providerCustomerId,
        input.providerWalletId,
      ]
    );
  });
  it('refuses to mark ambiguous or unidentified acknowledgements as newly created', async () => {
    const execute = vi.fn();
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    await expect(
      store.record({ ...input, resultCode: 'ambiguous' })
    ).rejects.toThrow('PiggyVest provisioning storage unavailable');
    await expect(
      store.record({ ...input, providerCustomerId: null })
    ).rejects.toThrow('PiggyVest provisioning storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
  it('fails closed when the dedicated atomic record cannot commit', async () => {
    const execute = vi.fn(async () => {
      throw new Error('synthetic-private-storage-error');
    });
    await expect(
      createPiggyvestProvisioningStore({ configuration, execute }).record(input)
    ).rejects.toThrow(/^PiggyVest provisioning storage unavailable$/);
    expect(execute).toHaveBeenCalledOnce();
  });
});
