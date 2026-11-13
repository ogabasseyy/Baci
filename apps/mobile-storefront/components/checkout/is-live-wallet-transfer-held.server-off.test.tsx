import { describe, expect, it, jest } from '@jest/globals';
import { isLiveWalletTransferHeld } from './is-live-wallet-transfer-held';

function readers({
  error = null,
  fetching = false,
  storeCredit = false,
  unknown = false,
}: {
  error?: Error | null;
  fetching?: boolean;
  storeCredit?: boolean;
  unknown?: boolean;
} = {}) {
  return {
    getWalletError: () => error,
    getWalletVerdict: jest.fn((_options?: { holdUnsettled?: boolean }) => ({
      walletIsStoreCredit: storeCredit,
      walletPrimaryUnknown: unknown,
    })),
    isFetchingNow: () => fetching,
  };
}

describe('isLiveWalletTransferHeld', () => {
  it('holds once the live wallet is PiggyVest store credit', () => {
    expect(isLiveWalletTransferHeld(readers({ storeCredit: true }), true)).toBe(
      true
    );
  });

  it('holds while the live PiggyVest verdict is unknown', () => {
    expect(isLiveWalletTransferHeld(readers({ unknown: true }), true)).toBe(
      true
    );
  });

  it('holds while a refresh is in flight or failed where PiggyVest is possible', () => {
    expect(isLiveWalletTransferHeld(readers({ fetching: true }), true)).toBe(
      true
    );
    expect(
      isLiveWalletTransferHeld(readers({ error: new Error('offline') }), true)
    ).toBe(true);
  });

  it('asks the verdict to hold an unsettled owner only where PiggyVest is possible', () => {
    const live = readers();
    isLiveWalletTransferHeld(live, true);
    isLiveWalletTransferHeld(live, false);
    expect(live.getWalletVerdict).toHaveBeenNthCalledWith(1, {
      holdUnsettled: true,
    });
    expect(live.getWalletVerdict).toHaveBeenNthCalledWith(2, {
      holdUnsettled: false,
    });
  });

  it("keeps today's transfer through a refresh where the server rules PiggyVest out", () => {
    expect(
      isLiveWalletTransferHeld(
        readers({ error: new Error('offline'), fetching: true }),
        false
      )
    ).toBe(false);
  });
});

describe('bugfix: a ruled-out merchant held by a timed-out wallet read', () => {
  it('does not hold on an unknown read where the server rules PiggyVest out', () => {
    // Arrange: the primary read timed out (unknown), merchant ruled out.
    const live = readers({ unknown: true });

    // Act + Assert
    expect(isLiveWalletTransferHeld(live, false)).toBe(false);
  });
});
