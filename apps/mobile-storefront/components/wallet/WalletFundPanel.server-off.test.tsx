import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletFundPanel } from '@/components/wallet/WalletFundPanel';
import Colors from '@/constants/Colors';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));

// With the server keeping PiggyVest off no primary verdict is provided: the
// panel is today's legacy panel, card funding included.
describe('WalletFundPanel with the server off', () => {
  it('shows the legacy account and keeps the card option', () => {
    render(
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
        fundAmount=""
        fundingAccount={{
          accountName: 'OGB / JOHN DOE',
          accountNumber: '9814644749',
          bankName: 'Wema Bank',
          provider: 'paystack',
        }}
        isCreatingFundingAccount={false}
        isFundPending={false}
        needsPhone={false}
        onChangeFundAmount={jest.fn()}
        onConfirmFund={jest.fn()}
        onCreateFundingAccount={jest.fn()}
        onResetFund={jest.fn()}
        onSubmitPhone={jest.fn(async () => ({ success: true }))}
      />
    );
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeOnTheScreen();
  });
});
