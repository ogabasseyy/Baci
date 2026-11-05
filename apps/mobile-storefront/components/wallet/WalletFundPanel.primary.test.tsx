import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletFundPanel } from '@/components/wallet/WalletFundPanel';
import Colors from '@/constants/Colors';
import { WalletPrimaryContext } from './WalletPrimaryContext';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));

const account = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Provider Bank',
  provider: 'piggyvest',
};

function renderPanel(primaryReady: boolean, fundAmount = '') {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletFundPanel
        canCreateFundingAccount
        colors={Colors.light}
        creditWatch={{
          armCheck: jest.fn(),
          creditedAmount: null,
          reset: jest.fn(),
          returnCtaHref: undefined,
          status: 'idle',
        }}
        fundAmount={fundAmount}
        fundingAccount={account}
        isCreatingFundingAccount={false}
        isFundPending={false}
        needsPhone={false}
        onChangeFundAmount={jest.fn()}
        onConfirmFund={jest.fn()}
        onCreateFundingAccount={jest.fn()}
        onResetFund={jest.fn()}
        onSubmitPhone={jest.fn(async () => ({ success: true }))}
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('WalletFundPanel with the PiggyVest main wallet ready', () => {
  it('offers only the PiggyVest account number, never card funding', () => {
    renderPanel(true);
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Fund with card instead' })
    ).toBeNull();
  });

  it('keeps card funding hidden even when an amount is prefilled', () => {
    renderPanel(true, '5000');
    expect(screen.queryByText(/card/i)).toBeNull();
  });

  it('keeps the card option for legacy customers', () => {
    renderPanel(false);
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeOnTheScreen();
  });
});
