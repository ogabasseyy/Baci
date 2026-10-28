import { describe, expect, it } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

describe('production savings direct identity read', () => {
  it('does not use created_at to start or resume transaction-list pagination', async () => {
    const input = requestInput([], fixture.wallet, 'production', {
      ...fixture.productionSingleTransaction,
      created_at: '2024-06-15T12:00:00.000Z',
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.productionSingleTransaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      input.fetchImplementation.mock.calls.map(
        ([url]) => new URL(String(url)).pathname
      )
    ).toEqual([
      `/api/v1/wallet/${fixture.reservation.sourceWalletId}`,
      `/api/v1/transaction/${fixture.productionSingleTransaction.id}`,
    ]);
  });
});
