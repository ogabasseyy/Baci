import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  clearPiggyvestPrimaryCapabilityCache,
  getPiggyvestPrimaryCapability,
  getPiggyvestPrimaryCapabilitySnapshot,
  isPrimaryWalletNotReady,
  refreshPiggyvestPrimaryCapability,
  rollbackObservedCapabilityOnNotReady,
  usePiggyvestPrimaryCapability,
} from './piggyvest-primary-capability';
import {
  NEGATIVE_CAPABILITY_TTL_MS,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

jest.mock('./piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));

const PRIMARY_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const read = piggyvestPrimaryWalletApi.read as jest.Mock;

function notReady(code: string) {
  return Object.assign(new Error('not ready'), { code });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPiggyvestPrimaryCapabilityCache();
});

describe('isPrimaryWalletNotReady', () => {
  it.each([
    'PIGGYVEST_NOT_READY',
    'PRIMARY_CARD_NOT_READY',
    'SAVINGS_NOT_READY',
  ])('recognizes the %s capability signal', (code) => {
    expect(isPrimaryWalletNotReady(notReady(code))).toBe(true);
  });

  it('rejects transient and foreign failures', () => {
    expect(isPrimaryWalletNotReady(new Error('boom'))).toBe(false);
    expect(isPrimaryWalletNotReady(notReady('PRIMARY_CARD_UNAVAILABLE'))).toBe(
      false
    );
    expect(isPrimaryWalletNotReady(notReady('SAVINGS_UNAVAILABLE'))).toBe(
      false
    );
    expect(isPrimaryWalletNotReady(null)).toBe(false);
    expect(isPrimaryWalletNotReady({ code: 503 })).toBe(false);
  });
});

describe('capability snapshot balance', () => {
  it('keeps the probe snapshot so callers reuse it instead of re-reading', async () => {
    const account = {
      accountName: 'Verified',
      accountNumber: '0987654321',
      bankName: 'Provider Bank',
      provider: 'piggyvest',
    };
    read.mockResolvedValue({ account, balanceKobo: 5000 });
    await expect(
      getPiggyvestPrimaryCapabilitySnapshot(PRIMARY_MERCHANT, 'user-a')
    ).resolves.toEqual({ available: true, account, balanceKobo: 5000 });
    // Cached verdicts carry no snapshot: nothing was fetched.
    await expect(
      getPiggyvestPrimaryCapabilitySnapshot(PRIMARY_MERCHANT, 'user-a')
    ).resolves.toEqual({ available: true });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
