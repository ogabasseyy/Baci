import { renderHook } from '@testing-library/react-native';
import { useWalletRouteActionSetup } from './use-wallet-route-action-setup';

jest.mock('@/lib/wallet-funding-intent', () => ({
  storeWalletFundingIntent: jest.fn(async () => undefined),
}));
jest.mock('@/lib/wallet-funding-session', () => ({
  startWalletFundingSession: jest.fn(() => new Promise(() => undefined)),
}));

function params() {
  return {
    bankTransfer: {
      openPanel: true,
      canCreateFundingAccount: false,
      createFundingAccount: jest.fn(),
      hasFundingAccount: true,
      hasWalletData: true,
      isCreating: false,
      needsPhone: false,
    },
    customerId: 'customer-a',
    routeAction: 'bank-transfer',
    routeIntentId: 'intent-a',
    routeRequiredAmount: '10000',
    walletReturnTo:
      '/wallet?action=savings&savingsGoalId=goal-a&savingsAmount=10000',
    setFundAmount: jest.fn(),
    setFundReturnTo: jest.fn(),
    setShowFundPanel: jest.fn(),
    setShowRedeemPanel: jest.fn(),
    setShowSavingsProgressModal: jest.fn(),
  };
}

it('opens primary bank details on a fresh savings handoff without creating another account or prefilling a card', () => {
  const input = params();
  renderHook(() => useWalletRouteActionSetup(input));
  expect(input.setShowFundPanel).toHaveBeenCalledWith(true);
  expect(input.setFundAmount).toHaveBeenCalledWith('');
  expect(input.bankTransfer.createFundingAccount).not.toHaveBeenCalled();
});

it('reopens the primary transfer sheet for a new intent on the same mounted wallet', () => {
  const input = params();
  const { rerender } = renderHook(
    ({ intent }: { intent: string }) =>
      useWalletRouteActionSetup({ ...input, routeIntentId: intent }),
    { initialProps: { intent: 'intent-a' } }
  );
  input.setShowFundPanel.mockClear();
  rerender({ intent: 'intent-b' });
  expect(input.setShowFundPanel).toHaveBeenCalledWith(true);
  expect(input.setFundReturnTo).toHaveBeenCalledWith(input.walletReturnTo);
});

it.each([
  'fund',
  'redeem',
  'savings',
])('preserves the %s flow when primary-wallet capability changes after mount', (routeAction) => {
  const input = params();
  const { rerender } = renderHook(
    ({ openPanel }: { openPanel: boolean }) =>
      useWalletRouteActionSetup({
        ...input,
        routeAction,
        bankTransfer: { ...input.bankTransfer, openPanel },
      }),
    { initialProps: { openPanel: false } }
  );
  input.setFundAmount.mockClear();
  input.setShowFundPanel.mockClear();
  input.setShowRedeemPanel.mockClear();
  input.setShowSavingsProgressModal.mockClear();

  rerender({ openPanel: true });
  rerender({ openPanel: false });

  expect(input.setFundAmount).not.toHaveBeenCalled();
  expect(input.setShowFundPanel).not.toHaveBeenCalled();
  expect(input.setShowRedeemPanel).not.toHaveBeenCalled();
  expect(input.setShowSavingsProgressModal).not.toHaveBeenCalled();
});
