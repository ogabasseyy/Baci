import { renderHook } from '@testing-library/react-native';
import { useWalletRouteActionSetup } from './use-wallet-route-action-setup';

const mockCloseOnBlur = jest.fn();
jest.mock('./use-close-savings-sheet-on-blur', () => ({
  useCloseSavingsSheetOnBlur: (setShow: (value: boolean) => void) =>
    mockCloseOnBlur(setShow),
}));
jest.mock('@/lib/wallet-funding-intent', () => ({
  storeWalletFundingIntent: jest.fn(),
}));
jest.mock('@/lib/wallet-funding-session', () => ({
  startWalletFundingSession: jest.fn(async () => null),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));

// Route handling only: nothing here reaches PiggyVest.
describe('server keeps PiggyVest off: useWalletRouteActionSetup', () => {
  it('binds the savings sheet to the wallet focus', () => {
    const setShowSavingsProgressModal = jest.fn();
    renderHook(() =>
      useWalletRouteActionSetup({
        bankTransfer: {
          canCreateFundingAccount: false,
          createFundingAccount: jest.fn(),
          hasFundingAccount: false,
          hasWalletData: true,
          isCreating: false,
          needsPhone: false,
        },
        customerId: 'customer-1',
        routeAction: 'savings',
        routeIntentId: undefined,
        routeRequiredAmount: '',
        walletReturnTo: undefined,
        setFundAmount: jest.fn(),
        setFundReturnTo: jest.fn(),
        setShowFundPanel: jest.fn(),
        setShowRedeemPanel: jest.fn(),
        setShowSavingsProgressModal,
      })
    );
    expect(mockCloseOnBlur).toHaveBeenCalledWith(setShowSavingsProgressModal);
  });
});
