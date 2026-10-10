import { Alert } from 'react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { navigateToWalletFunding } from './navigate-to-wallet-funding';
import { promptUtilityWalletFunding } from './utility-wallet-funding-prompt';

jest.mock('./navigate-to-wallet-funding', () => ({
  navigateToWalletFunding: jest.fn(),
}));

const mockNavigateToWalletFunding = navigateToWalletFunding as jest.Mock;

describe('promptUtilityWalletFunding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the shortfall and offers wallet funding', () => {
    promptUtilityWalletFunding({ amount: 1000, balance: 200 });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Fund Your Wallet',
      expect.stringContaining('₦1,000'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Fund Wallet' }),
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
      ])
    );
  });

  it('routes into wallet funding with the return link when Fund Wallet is tapped', () => {
    const returnToHref = '/utilities/airtime' as WalletReturnHref;
    promptUtilityWalletFunding({ amount: 1000, balance: 200, returnToHref });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.text === 'Fund Wallet')?.onPress?.();

    expect(mockNavigateToWalletFunding).toHaveBeenCalledWith(returnToHref);
  });
});
