import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  readPrimaryFundingAccount,
  resolveWalletFundingAccount,
} from './resolve-wallet-funding-account';

const mockIsPrimaryMerchant = jest.fn<(id: string) => boolean>();
const mockSnapshot = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRead = jest.fn<(...args: unknown[]) => Promise<unknown>>();
let mockActiveUserId: string | undefined = 'user-1';

jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id: string) => mockIsPrimaryMerchant(id),
}));
const mockRollback = jest.fn(
  (_merchantId: unknown, error: unknown) =>
    (error as { code?: string })?.code === 'PIGGYVEST_NOT_READY'
);
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapabilitySnapshot: (...args: unknown[]) =>
    mockSnapshot(...args),
  isPrimaryWalletNotReady: (error: unknown) =>
    (error as { code?: string })?.code === 'PIGGYVEST_NOT_READY',
  rollbackObservedCapabilityOnNotReady: (merchantId: unknown, error: unknown) =>
    mockRollback(merchantId, error),
}));
jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: {
    read: (...args: unknown[]) => mockRead(...args),
  },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: mockActiveUserId } }) },
}));

const legacyRow = {
  account_name: 'Legacy',
  account_number: '0123456789',
  bank_name: 'Paystack Bank',
  provider: 'paystack',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveUserId = 'user-1';
  mockIsPrimaryMerchant.mockReturnValue(false);
});

describe('primary funding account with the server off', () => {
  it('settles not_ready when the capability probe says unavailable', async () => {
    mockSnapshot.mockResolvedValue({ available: false });
    await expect(readPrimaryFundingAccount('m1', 'user-1')).resolves.toEqual({
      status: 'not_ready',
    });
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('settles not_ready when the wallet endpoint answers not ready', async () => {
    mockIsPrimaryMerchant.mockReturnValue(true);
    mockRead.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'PIGGYVEST_NOT_READY' })
    );
    await expect(readPrimaryFundingAccount('m1', 'user-1')).resolves.toEqual({
      status: 'not_ready',
    });
    // bugfix: the wallet read's not-ready rolls a stale positive verdict back.
    expect(mockRollback).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ code: 'PIGGYVEST_NOT_READY' })
    );
  });

  it('settles unavailable, never throws, when the endpoint is unreachable', async () => {
    mockIsPrimaryMerchant.mockReturnValue(true);
    mockRead.mockRejectedValue(new Error('network down'));
    await expect(readPrimaryFundingAccount('m1', 'user-1')).resolves.toEqual({
      status: 'unavailable',
    });
    mockIsPrimaryMerchant.mockReturnValue(false);
    mockSnapshot.mockRejectedValue(new Error('network down'));
    await expect(readPrimaryFundingAccount('m1', 'user-1')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('makes no request when the session user differs', async () => {
    mockActiveUserId = 'someone-else';
    await expect(readPrimaryFundingAccount('m1', 'user-1')).resolves.toEqual({
      status: 'unavailable',
    });
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('keeps the legacy funding account only for not_ready', () => {
    expect(
      resolveWalletFundingAccount(legacyRow, { status: 'not_ready' })
    ).toEqual(legacyRow);
    expect(
      resolveWalletFundingAccount(legacyRow, { status: 'unavailable' })
    ).toBeNull();
  });
});
