import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRuntime, mockExecute, mockExecutor } = vi.hoisted(() => ({
  mockRuntime: vi.fn(),
  mockExecute: vi.fn(),
  mockExecutor: vi.fn(),
}));

vi.mock('@/schemas/wallet-dva-provisioner-runtime', () => ({
  readWalletDvaProvisionerRuntime: (...args: unknown[]) => mockRuntime(...args),
}));
vi.mock('./wallet-dva-provisioner-executor', () => ({
  createWalletDvaProvisionerExecutor: (...args: unknown[]) =>
    mockExecutor(...args),
}));

import { createWalletDvaAccountWriter } from './wallet-dva-provisioner';

const input = {
  accountName: 'José Store / Zoë',
  accountNumber: '1234567890',
  bankName: 'Wéma Bank',
  bankSlug: 'wema-bank',
  consentedAt: '2026-11-22T10:00:00.000Z',
  currency: 'NGN' as const,
  customerId: '11111111-1111-4111-8111-111111111111',
  merchantId: '22222222-2222-4222-8222-222222222222',
  providerAccountId: '97',
  providerCustomerCode: 'CUS_wallet1',
  providerSubaccountCode: 'ACCT_merchant1',
  userId: '33333333-3333-4333-8333-333333333333',
};

const row = {
  account_name: input.accountName,
  account_number: input.accountNumber,
  bank_name: input.bankName,
  bank_slug: input.bankSlug,
  consented_at: input.consentedAt,
  currency: 'NGN',
  customer_id: input.customerId,
  id: '44444444-4444-4444-8444-444444444444',
  merchant_id: input.merchantId,
  metadata: { source: 'wallet_dva' },
  provider: 'paystack',
  provider_account_id: '97',
  provider_customer_code: 'CUS_wallet1',
  provider_subaccount_code: 'ACCT_merchant1',
  status: 'active',
};

describe('wallet DVA account writer result boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime.mockReturnValue({
      database: { login: 'baci_wallet_dva_provisioner' },
    });
    mockExecutor.mockReturnValue(mockExecute);
    mockExecute.mockResolvedValue(row);
  });

  it('accepts the exact SQL whitelist projection and preserves Unicode names', async () => {
    const writer = createWalletDvaAccountWriter();
    expect(writer).not.toBeNull();
    await expect(writer?.(input)).resolves.toMatchObject({
      accountName: 'José Store / Zoë',
      bankName: 'Wéma Bank',
      customerId: input.customerId,
      merchantId: input.merchantId,
    });
  });

  it('rejects extra SQL fields rather than accepting an unreviewed projection', async () => {
    mockExecute.mockResolvedValue({ ...row, created_at: input.consentedAt });
    const writer = createWalletDvaAccountWriter();

    await expect(writer?.(input)).rejects.toMatchObject({
      code: 'WALLET_DVA_STORAGE_ERROR',
      message:
        'Wallet funding account storage returned an invalid owner or provider binding',
    });
  });

  it('does not return a row from another owner or merchant', async () => {
    mockExecute.mockResolvedValue({
      ...row,
      customer_id: '55555555-5555-4555-8555-555555555555',
    });
    const writer = createWalletDvaAccountWriter();

    await expect(writer?.(input)).rejects.toMatchObject({
      code: 'WALLET_DVA_STORAGE_ERROR',
    });
  });

  it.each([
    ['provider customer', { provider_customer_code: 'CUS_other' }],
    ['provider subaccount', { provider_subaccount_code: 'ACCT_other' }],
  ])('rejects an owner-slot result with a different %s', async (_label, change) => {
    mockExecute.mockResolvedValue({ ...row, ...change });
    const writer = createWalletDvaAccountWriter();

    await expect(writer?.(input)).rejects.toMatchObject({
      code: 'WALLET_DVA_STORAGE_ERROR',
      message:
        'Wallet funding account storage returned an invalid owner or provider binding',
    });
  });

  it('maps only stable, known database conflict codes', async () => {
    mockExecute.mockRejectedValue(new Error('PAYSTACK_DVA_ALIAS_CONFLICT'));
    const writer = createWalletDvaAccountWriter();

    await expect(writer?.(input)).rejects.toMatchObject({
      code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
    });
  });
});
