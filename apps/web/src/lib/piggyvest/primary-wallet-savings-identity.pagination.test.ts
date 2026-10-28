import { describe, expect, it } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

describe('production direct wallet-scoped identity proof', () => {
  it('accepts the exact direct transaction without requesting transaction pages', async () => {
    const input = requestInput([]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.productionSingleTransaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
    const transactionUrl = new URL(
      String(input.fetchImplementation.mock.calls[1][0])
    );
    expect(transactionUrl.pathname).toBe(
      `/api/v1/transaction/${fixture.singleTransaction.id}`
    );
    expect(transactionUrl.searchParams.get('wallet_id')).toBe(
      fixture.reservation.sourceWalletId
    );
  });

  it('fails closed on a direct transaction category mismatch', async () => {
    const input = requestInput([], fixture.wallet, 'production', {
      ...fixture.productionSingleTransaction,
      category: 'bank-outflow',
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('preserves direct terminal-failure evidence for a bound hold release', async () => {
    const input = requestInput([], fixture.wallet, 'production', {
      ...fixture.productionSingleTransaction,
      status: 'failed',
    });
    input.providerResponse = {
      ...fixture.providerResponse,
      data: { ...fixture.providerResponse.data, status: 'failed' },
    };

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: { id: fixture.transaction.id, status: 'failed' },
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('fails closed on the documented reference-status failure without an internal transaction ID', async () => {
    const input = requestInput([]);
    const providerResponse = {
      status: true as const,
      data: {
        reference: fixture.reservation.reference,
        status: 'failed' as const,
        amount: fixture.reservation.amountKobo,
      },
    };

    expect(
      await resolvePrimaryWalletSavingsIdentity({ ...input, providerResponse })
    ).toBeNull();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails before transaction lookup when the authenticated wallet ownership does not match', async () => {
    const input = requestInput([], {
      ...fixture.wallet,
      api_customer_id: 'another-customer',
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
