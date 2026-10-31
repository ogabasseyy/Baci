import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';
import {
  fixture,
  goalId,
  ready,
  walletName,
} from './primary-savings-provisioning.input.test-support';

vi.mock('server-only', () => ({}));

// The Ogabassey business wallet that receives MAIN-wallet interest.
const BUSINESS_PAYOUT_WALLET = '01JBZ8Q5W3X9R2K4M6N8P0T2V4';

function withInterestChoice(interestAccepted: boolean) {
  const input = fixture();
  input.interestAccepted = interestAccepted;
  input.store.prepare.mockImplementation(async () => ({
    status: 'claimed',
    claimToken: 'claim',
    providerCustomerId: 'customer',
    primaryWalletId: 'primary',
    providerWalletId: null,
    walletName,
    interestAccepted,
  }));
  input.store.read.mockImplementation(async () => ({
    status: 'pending',
    claimToken: null,
    providerCustomerId: 'customer',
    primaryWalletId: 'primary',
    providerWalletId: 'destination',
    walletName,
    interestAccepted,
  }));
  input.listWallets.mockResolvedValueOnce([]);
  return input;
}

async function goalWallet(input: ReturnType<typeof fixture>) {
  return (await input.retrieveWallet()) as Record<string, unknown>;
}

describe('primary savings goal wallet interest', () => {
  it.each([
    true,
    false,
  ])('creates the goal with an explicit accrual choice (%s) and never a payout wallet', async (interestAccepted) => {
    const input = withInterestChoice(interestAccepted);
    await provisionPrimarySavingsWallet(input);
    expect(input.createWallet).toHaveBeenCalledOnce();
    const request = input.createWallet.mock.calls[0][0];
    expect(request).toEqual({
      customerId: 'customer',
      subaccountName: walletName,
      reserveVirtualAccount: true,
      enableInterestAccrual: interestAccepted,
    });
    expect(request).not.toHaveProperty('interestPayoutWallet');
    expect(JSON.stringify(request)).not.toContain(BUSINESS_PAYOUT_WALLET);
  });

  it('surfaces a 422 validation decline as rejected without retrying, enrolling or moving money', async () => {
    const input = withInterestChoice(true);
    input.createWallet.mockRejectedValueOnce(
      new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'One or more validation errors occurred',
        422,
        true
      )
    );
    const outcome = await provisionPrimarySavingsWallet(input);
    expect(outcome.status).toBe('rejected');
    expect(outcome.accounts).toEqual([]);
    expect(input.createWallet).toHaveBeenCalledOnce();
    expect(input.store.record).toHaveBeenCalledExactlyOnceWith(
      goalId,
      'claim',
      null
    );
    expect(input.store.enroll).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
  });

  it('keeps a 422 without a provider decline envelope ambiguous', async () => {
    const input = withInterestChoice(true);
    input.createWallet.mockRejectedValueOnce(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Not JSON', 422, false)
    );
    expect((await provisionPrimarySavingsWallet(input)).status).toBe('pending');
    expect(input.store.enroll).not.toHaveBeenCalled();
  });

  it.each([
    ['the Ogabassey business wallet', BUSINESS_PAYOUT_WALLET],
    ['any other foreign wallet', 'foreign-wallet'],
  ])('never enrolls a goal whose readback routes its interest to %s', async (_label, payout) => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue({
      ...(await goalWallet(input)),
      interest_payout_wallet: payout,
    });
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.store.enroll).not.toHaveBeenCalled();
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', null],
    ['the goal wallet itself', 'destination'],
    ["the customer's own main wallet", 'primary'],
  ])('enrolls a goal whose interest stays with the customer (%s)', async (_label, payout) => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue({
      ...(await goalWallet(input)),
      interest_payout_wallet: payout,
    });
    expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
    expect(input.store.enroll).toHaveBeenCalledOnce();
  });
});
