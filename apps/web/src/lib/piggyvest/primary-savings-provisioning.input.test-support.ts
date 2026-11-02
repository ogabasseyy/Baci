import { vi } from 'vitest';

/** Input doubles for provisionPrimarySavingsWallet suites. */

export const goalId = '00000000-0000-4000-8000-000000000006';
export const scope = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  integrationId: '00000000-0000-4000-8000-000000000004',
  businessId: 'business',
  environment: 'staging' as const,
};
// buildPrimaryGoalWalletName(scope.integrationId, goalId), pinned literally
// (also by primary-goal-wallet-name.test.ts and the database suite).
export const walletName = 'baci-save-d80a9fbb7f8c666ce4462294b4e53d25';
export function fixture() {
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
export const ready = {
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
