import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWalletFundRedeemPanels } from './use-wallet-fund-redeem-panels';
import { fundWallet, redeemWalletPoints } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({
  fundWallet: jest.fn(),
  redeemWalletPoints: jest.fn(),
}));

function setup(refetchWalletBalance = jest.fn(async () => undefined)) {
  return {
    ...renderHook(() =>
      useWalletFundRedeemPanels({
        refetchWalletBalance,
        redeemPointsMutation: jest.fn(async () => ({})),
        routeAction: 'fund',
        routeRequiredAmount: '100',
      })
    ),
    refetchWalletBalance,
  };
}

beforeEach(() => jest.clearAllMocks());

it('refreshes the full wallet balance and history after any funding-panel reset without submitting a payment', async () => {
  const { result, refetchWalletBalance } = setup();
  expect(refetchWalletBalance).not.toHaveBeenCalled();

  act(() => result.current.resetFundPanel());

  expect(result.current.showFundPanel).toBe(false);
  expect(result.current.fundAmount).toBe('');
  await waitFor(() => expect(refetchWalletBalance).toHaveBeenCalledTimes(1), {
    timeout: 500,
  });
  expect(fundWallet).not.toHaveBeenCalled();
  expect(redeemWalletPoints).not.toHaveBeenCalled();
});

it('closes funding immediately and handles a failed refresh without an unhandled rejection', async () => {
  const refetchWalletBalance = jest.fn(async () => {
    throw new Error('Offline');
  });
  const { result } = setup(refetchWalletBalance);

  await act(async () => result.current.resetFundPanel());

  expect(result.current.showFundPanel).toBe(false);
  expect(refetchWalletBalance).toHaveBeenCalledTimes(1);
  expect(fundWallet).not.toHaveBeenCalled();
});

it('does not refresh funding when only the redeem panel is reset', () => {
  const { result, refetchWalletBalance } = setup();

  act(() => result.current.resetRedeemPanel());

  expect(refetchWalletBalance).not.toHaveBeenCalled();
});
