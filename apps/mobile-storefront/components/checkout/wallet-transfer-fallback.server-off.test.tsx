import { describe, expect, it, jest } from '@jest/globals';
import {
  parseWalletTransferFallback,
  walletTransferFallbackReason,
} from './wallet-transfer-fallback';

let mockVerdict: boolean | null = null;
const mockVerdictFor: Record<string, boolean | null> = {};
jest.mock('@/lib/read-piggyvest-capability-now', () => ({
  readPiggyvestCapabilityNow: (id?: string | null) =>
    id && id in mockVerdictFor ? mockVerdictFor[id] : mockVerdict,
}));

describe('walletTransferFallbackReason', () => {
  it('is the PiggyVest case once the merchant is confirmed', () => {
    mockVerdict = true;
    expect(walletTransferFallbackReason('merchant-1')).toBe('piggyvest');
  });

  it('bugfix: is "unconfirmed" while the verdict is unknown', () => {
    mockVerdict = null;
    expect(walletTransferFallbackReason('merchant-1')).toBe('unconfirmed');
  });
});

describe('bugfix: fallback notice read a merchant switched to mid-submit', () => {
  it('judges the merchant the order was submitted to', () => {
    // Arrange: submitted at a PiggyVest merchant; the store now holds one
    // whose verdict is unknown.
    mockVerdictFor['submitted-merchant'] = true;
    mockVerdictFor['switched-merchant'] = null;

    // Act + Assert
    expect(walletTransferFallbackReason('submitted-merchant')).toBe(
      'piggyvest'
    );
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

describe('bugfix: repeated fallback query key dropped the notice', () => {
  it('reads the first value when the router hands over an array', () => {
    expect(parseWalletTransferFallback(['piggyvest', 'unconfirmed'])).toBe(
      'piggyvest'
    );
    expect(parseWalletTransferFallback(['unconfirmed'])).toBe('unconfirmed');
  });

  it('stays unset for an empty array', () => {
    expect(parseWalletTransferFallback([])).toBeUndefined();
  });
});
