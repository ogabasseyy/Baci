import { describe, expect, it, vi } from 'vitest';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';

vi.mock('server-only', () => ({}));
const goalId = '00000000-0000-4000-8000-000000000006';
const scope = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  integrationId: '00000000-0000-4000-8000-000000000004',
  businessId: 'business',
  environment: 'staging' as const,
};
const walletName = `baci-save:${scope.integrationId}:${goalId}`;
function fixture() {
  const mapping = {
    status: 'pending' as const,
    claimToken: null,
    providerCustomerId: 'customer',
    primaryWalletId: 'primary',
    providerWalletId: 'destination',
    walletName,
    interestAccepted: false,
  };
  return {
    scope,
    goalId,
    mode: 'provision' as 'provision' | 'recover',
    interestAccepted: false,
    store: {
      prepare: vi.fn().mockResolvedValue({
        ...mapping,
        status: 'claimed',
        providerWalletId: null,
        claimToken: 'claim',
      }),
      read: vi.fn().mockResolvedValue(mapping),
      record: vi.fn().mockResolvedValue(true),
      enroll: vi.fn().mockResolvedValue(true),
    },
    createWallet: vi.fn().mockResolvedValue({ id: 'destination' }),
    listWallets: vi
      .fn()
      .mockResolvedValue([
        { id: 'destination', name: walletName, status: 'active' },
      ]),
    retrieveWallet: vi.fn().mockResolvedValue({
      id: 'destination',
      name: walletName,
      api_customer_id: 'customer',
      business_id: 'business',
      currency: 'NGN',
      type: 'api',
      status: 'active',
      balance: 0,
    }),
    retrieveAccounts: vi.fn().mockResolvedValue([
      {
        account_number: '0123456789',
        account_name: 'Synthetic',
        bank_name: 'Synthetic Bank',
      },
    ]),
  };
}
const ready = {
  goalId,
  status: 'ready',
  interestAccepted: false,
  interestEnrollment: 'not_requested',
  accounts: [
    {
      accountNumber: '0123456789',
      accountName: 'Synthetic',
      bankName: 'Synthetic Bank',
    },
  ],
};
describe('primary savings provisioning connection', () => {
  it('creates once for the verified customer, then enrolls only provider-confirmed destination', async () => {
    const input = fixture();
    expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
    expect(input.createWallet).toHaveBeenCalledWith({
      customerId: 'customer',
      subaccountName: walletName,
      reserveVirtualAccount: true,
      enableInterestAccrual: false,
    });
    expect(input.listWallets).toHaveBeenCalledWith('customer');
    expect(input.store.enroll).toHaveBeenCalledWith(goalId, {
      providerCustomerId: 'customer',
      providerWalletId: 'destination',
      walletName,
      businessId: 'business',
      currency: 'NGN',
      status: 'active',
      type: 'api',
      hasFundingAccount: true,
      interestAccepted: false,
    });
  });
  it('does not repeat creation after an ambiguous timeout and recovers by reads', async () => {
    const input = fixture();
    input.createWallet.mockRejectedValueOnce(
      new Error('private provider details')
    );
    input.store.prepare
      .mockResolvedValueOnce(await input.store.prepare())
      .mockResolvedValue({
        ...(await input.store.read()),
        providerWalletId: null,
      });
    expect((await provisionPrimarySavingsWallet(input)).status).toBe('pending');
    expect(input.store.record).toHaveBeenCalledWith(goalId, 'claim', null);
    expect(input.store.enroll).not.toHaveBeenCalled();
    expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
    expect(input.createWallet).toHaveBeenCalledOnce();
  });
  it('recovery never prepares or posts and reports an unstarted intent', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.store.read.mockResolvedValue(null);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'not_found'
    );
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.createWallet).not.toHaveBeenCalled();
  });
  it('keeps asynchronous creation pending until a wallet is active and funded-channel ready', async () => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      status: 'pending',
    });
    expect((await provisionPrimarySavingsWallet(input)).status).toBe('pending');
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it('never recreates when the customer-filtered page has no matching wallet', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.listWallets.mockResolvedValue([]);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe('pending');
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'foreign' },
    { name: 'foreign' },
    { business_id: 'foreign' },
    { currency: 'USD' },
    { type: 'business' },
    { api_customer_id: 'foreign-customer' },
  ])('does not enroll foreign or malformed wallet proof %j', async (change) => {
    const input = fixture();
    input.mode = 'recover';
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      ...change,
    });
    expect(['conflict', 'unavailable']).toContain(
      (await provisionPrimarySavingsWallet(input)).status
    );
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it.each([
    'primary',
    'foreign',
  ])('does not adopt the primary or a changed accepted wallet %s', async (id) => {
    const input = fixture();
    input.mode = 'recover';
    input.listWallets.mockResolvedValue([
      { id, name: walletName, status: 'active' },
    ]);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it('refuses a same-named wallet owned by a different provider customer', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      api_customer_id: 'foreign-customer',
    });
    const result = await provisionPrimarySavingsWallet(input);
    expect(result.status).toBe('conflict');
    expect(result.accounts).toEqual([]);
    expect(input.store.enroll).not.toHaveBeenCalled();
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
  });
  it('quarantines ambiguous duplicate names without selecting a wallet', async () => {
    const input = fixture();
    input.listWallets.mockResolvedValue([
      { id: 'destination', name: walletName, status: 'active' },
      { id: 'other', name: walletName, status: 'active' },
    ]);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it('waits for valid funding channels rather than inventing a BVN or account', async () => {
    const input = fixture();
    input.retrieveAccounts.mockResolvedValue([]);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe('pending');
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it('does not claim readiness when enrollment is rejected', async () => {
    const input = fixture();
    input.store.enroll.mockResolvedValue(false);
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
  });
  it('does not call the provider without an owned durable claim', async () => {
    const input = fixture();
    input.store.prepare.mockRejectedValue(new Error('private ownership error'));
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'unavailable'
    );
    expect(input.createWallet).not.toHaveBeenCalled();
  });
  it('uses explicit persisted interest opt-in without claiming verified payout or enablement', async () => {
    const input = fixture();
    input.interestAccepted = true;
    input.store.prepare.mockResolvedValue({
      ...(await input.store.prepare()),
      interestAccepted: true,
    });
    input.store.read.mockResolvedValue({
      ...(await input.store.read()),
      interestAccepted: true,
    });
    expect(await provisionPrimarySavingsWallet(input)).toEqual({
      ...ready,
      interestAccepted: true,
      interestEnrollment: 'requested',
    });
    expect(input.createWallet).toHaveBeenCalledWith(
      expect.objectContaining({ enableInterestAccrual: true })
    );
    expect(input.store.prepare).toHaveBeenLastCalledWith(goalId, true);
  });
  it('never creates a no-interest wallet instead of an opted-in request on mismatched replay', async () => {
    const input = fixture();
    input.interestAccepted = true;
    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.enroll).not.toHaveBeenCalled();
  });
  it('keeps saved opt-in immutable while read-only recovery confirms accounts', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.store.read.mockResolvedValue({
      ...(await input.store.read()),
      interestAccepted: true,
    });
    expect(await provisionPrimarySavingsWallet(input)).toEqual({
      ...ready,
      interestAccepted: true,
      interestEnrollment: 'requested',
    });
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.record).not.toHaveBeenCalled();
  });
  it('does not expose accounts until durable enrollment succeeds', async () => {
    const input = fixture();
    input.store.enroll.mockResolvedValue(false);
    expect((await provisionPrimarySavingsWallet(input)).accounts).toEqual([]);
  });
});
