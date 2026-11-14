import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useWalletFundRedeemPanels } from './use-wallet-fund-redeem-panels';

const mockRedeem = jest.fn(async (_params: unknown) => undefined);
jest.mock('./wallet-screen.handlers', () => ({
  fundWallet: jest.fn(),
  redeemWalletPoints: (params: unknown) => mockRedeem(params),
}));

describe('fund and redeem panels with the server keeping PiggyVest off', () => {
  it('passes the store to the redeem handler so it can keep today’s alert', async () => {
    const merchant = '11111111-1111-4111-8111-111111111111';
    const { result } = renderHook(() =>
      useWalletFundRedeemPanels({
        activeMerchantId: merchant,
        redeemPointsMutation: jest.fn() as never,
        routeRequiredAmount: '',
      })
    );

    await act(async () => {
      await result.current.handleRedeemPoints();
    });

    expect(mockRedeem).toHaveBeenCalledWith(
      expect.objectContaining({ activeMerchantId: merchant })
    );
  });
});
