import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { readFreshPrimaryBalance } from './start-savings-wallet-balance';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
let mockSignedIn = true;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () =>
      mockSignedIn
        ? { merchantId: 'm', user: { id: 'u' } }
        : { merchantId: 'm', user: null },
  },
}));

const account = {
  accountName: 'Verified',
  accountNumber: '0987654321',
  bankName: 'Provider Bank',
};
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

describe('readFreshPrimaryBalance', () => {
  beforeEach(() => {
    mockSignedIn = true;
    read.mockReset();
  });

  it('returns the PiggyVest balance in naira from a fresh read', async () => {
    read.mockResolvedValueOnce({ account, balanceKobo: 1_250_050 } as never);
    expect(await readFreshPrimaryBalance()).toBe(12_500.5);
    expect(read).toHaveBeenCalledWith('m', 'u');
  });

  it.each([
    ['no account', { account: null, balanceKobo: 100 }],
    ['no balance', { account, balanceKobo: null }],
    ['a negative balance', { account, balanceKobo: -1 }],
    ['a fractional balance', { account, balanceKobo: 1.5 }],
  ])('returns null for %s', async (_label, snapshot) => {
    read.mockResolvedValueOnce(snapshot as never);
    expect(await readFreshPrimaryBalance()).toBeNull();
  });

  it('returns null when the read fails', async () => {
    read.mockRejectedValueOnce(new Error('timeout'));
    expect(await readFreshPrimaryBalance()).toBeNull();
  });

  it('returns null without reading when nobody is signed in', async () => {
    mockSignedIn = false;
    expect(await readFreshPrimaryBalance()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
