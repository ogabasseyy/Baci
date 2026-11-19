import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { isWalletSavingsReturnHref } from '@/lib/sanitize-wallet-return-to';
import {
  createOpenSavingsShortfallFunding,
  SAVINGS_SHORTFALL_RETURN_TO,
} from './open-savings-shortfall-funding';
import { useWalletFundRedeemPanels } from './use-wallet-fund-redeem-panels';

jest.mock('./wallet-screen.handlers', () => ({
  fundWallet: jest.fn(),
  redeemWalletPoints: jest.fn(),
}));

describe('savings shortfall funding destination', () => {
  it('replaces an earlier IMEI-check return with the savings destination', () => {
    const { result } = renderHook(() => {
      const panels = useWalletFundRedeemPanels({
        redeemPointsMutation: jest.fn() as never,
        routeAction: 'fund',
        routeRequiredAmount: '1000',
        walletReturnTo: '/imei-check',
      });
      return panels;
    });
    expect(result.current.fundReturnTo).toBe('/imei-check');
    expect(isWalletSavingsReturnHref(result.current.fundReturnTo)).toBe(false);
    // The customer closes that panel, then taps Add money for savings.
    act(() => result.current.resetFundPanel());
    expect(result.current.fundReturnTo).toBe('/imei-check');
    const open = createOpenSavingsShortfallFunding({
      setFundReturnTo: result.current.setFundReturnTo,
      setShowFundPanel: result.current.setShowFundPanel,
      setShowSavingsProgressModal: jest.fn(),
    });
    act(() => open());
    expect(result.current.showFundPanel).toBe(true);
    expect(result.current.fundReturnTo).toBe(SAVINGS_SHORTFALL_RETURN_TO);
    expect(isWalletSavingsReturnHref(result.current.fundReturnTo)).toBe(true);
  });

  it('closes the savings progress sheet first', () => {
    const setShowSavingsProgressModal = jest.fn();
    createOpenSavingsShortfallFunding({
      setFundReturnTo: jest.fn(),
      setShowFundPanel: jest.fn(),
      setShowSavingsProgressModal,
    })();
    expect(setShowSavingsProgressModal).toHaveBeenCalledWith(false);
  });
});
