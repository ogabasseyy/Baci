import { describe, expect, it } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

describe('primary savings transfer identity corroboration', () => {
  it('uses the wallet-scoped single-transaction read as production identity proof', async () => {
    const input = requestInput();

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.productionSingleTransaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      input.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toEqual([
      'https://api.piggyvest.business/api/v1/wallet/source-wallet',
      'https://api.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet',
    ]);
  });

  it('uses the exact single-transaction lookup only for staging', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging');

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'staging',
      wallet: fixture.wallet,
      transaction: fixture.singleTransaction,
    });
    expect(
      input.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toEqual([
      'https://staging.piggyvest.business/api/v1/wallet/source-wallet',
      'https://staging.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet',
    ]);
  });

  it('strips unneeded fields from a richer staging single-transaction response', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      business_id: 'business',
      wallet_id: 'source-wallet',
      currency: 'NGN',
      type: 'debit',
      category: 'p2p',
      charge: 0,
      provider_reference: 'provider-reference',
      unrelated_provider_metadata: { retainedByProvider: true },
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'staging',
      wallet: fixture.wallet,
      transaction: fixture.singleTransaction,
    });
  });

  it('corroborates staging when verify customer_id is the provider customer ID', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      customer_id: fixture.reservation.providerCustomerId,
    });
    input.providerResponse = {
      ...fixture.providerResponse,
      data: {
        ...fixture.providerResponse.data,
        customer_id: fixture.reservation.providerCustomerId,
      },
    };

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'staging',
      transaction: { customer_id: fixture.reservation.providerCustomerId },
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 'another-transaction' },
    { status: 'pending' },
    { customer_id: 'another-business' },
    { source_wallet: 'another-source' },
    { destination_wallet: 'another-destination' },
    { amount: 9999 },
    { fee: 1 },
    { reference: 'another-provider-reference' },
    { third_party_reference: null },
    { third_party_reference: 'another-merchant-reference' },
    { internal_reference: 'another-transaction' },
  ])('fails closed on a staging single-transaction mismatch: %j', async (change) => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      ...change,
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([
    { customer_id: fixture.reservation.providerCustomerId },
    { customer_id: 'other-business' },
    { business_id: 'other-business' },
    { destination_customer_id: 'other-customer' },
    { source_wallet: 'other-wallet' },
    { destination_wallet: 'other-wallet' },
    { amount: 9999 },
    { third_party_reference: 'other-reference' },
    { currency: 'USD' },
  ])('rejects conflicting transfer fields before requesting corroboration: %j', async (change) => {
    const input = requestInput();

    expect(
      await resolvePrimaryWalletSavingsIdentity({
        ...input,
        providerResponse: {
          ...fixture.providerResponse,
          data: { ...fixture.providerResponse.data, ...change },
        },
      })
    ).toBeNull();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other-wallet' },
    { business_id: 'other-business' },
    { api_customer_id: 'other-customer' },
    { is_frozen: true },
    { currency: 'USD' },
  ])('rejects a source wallet with conflicting ownership or state: %j', async (change) => {
    const input = requestInput([fixture.page], {
      ...fixture.wallet,
      ...change,
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed reservations, unknown environments and empty credentials without network access', async () => {
    const input = requestInput();
    for (const change of [
      { reservation: {} },
      { environment: 'unknown' },
      { token: ' ' },
    ]) {
      expect(
        await resolvePrimaryWalletSavingsIdentity({ ...input, ...change })
      ).toBeNull();
    }
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});
