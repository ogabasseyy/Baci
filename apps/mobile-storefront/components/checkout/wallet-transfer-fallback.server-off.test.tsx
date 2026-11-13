import { describe, expect, it, jest } from '@jest/globals';
import {
  parseWalletTransferFallback,
  walletTransferFallbackReason,
} from './wallet-transfer-fallback';

let mockVerdict: boolean | null = null;
jest.mock('@/lib/read-piggyvest-capability-now', () => ({
  readPiggyvestCapabilityNow: () => mockVerdict,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ merchantId: 'merchant-1' }) },
}));

describe('walletTransferFallbackReason', () => {
  it('is the PiggyVest case once the merchant is confirmed', () => {
    mockVerdict = true;
    expect(walletTransferFallbackReason()).toBe('piggyvest');
  });

  it('bugfix: is "unconfirmed" while the verdict is unknown', () => {
    mockVerdict = null;
    expect(walletTransferFallbackReason()).toBe('unconfirmed');
  });
});

describe('parseWalletTransferFallback', () => {
  it('reads both reasons and the original "1" flag', () => {
    expect(parseWalletTransferFallback('unconfirmed')).toBe('unconfirmed');
    expect(parseWalletTransferFallback('piggyvest')).toBe('piggyvest');
    expect(parseWalletTransferFallback('1')).toBe('piggyvest');
  });

  it('shows no notice on an ordinary transfer (server keeps PiggyVest off)', () => {
    expect(parseWalletTransferFallback(undefined)).toBeUndefined();
    expect(parseWalletTransferFallback('other')).toBeUndefined();
  });
});
