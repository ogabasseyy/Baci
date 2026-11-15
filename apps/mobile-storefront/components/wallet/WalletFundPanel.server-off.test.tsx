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

const panelProps = () => ({
  canCreateFundingAccount: true,
  colors: Colors.light,
  fundAmount: '',
  isCreatingFundingAccount: false,
  isFundPending: false,
  needsPhone: false,
  onChangeFundAmount: jest.fn(),
  onConfirmFund: jest.fn(),
  onCreateFundingAccount: jest.fn(),
  onResetFund: jest.fn(),
  onSubmitPhone: jest.fn(async () => ({ success: true as const })),
});

describe('bugfix: the PiggyVest deposit fee appeared nowhere in Add money', () => {
  it('says a deposit fee may be taken, only for the PiggyVest account', () => {
    const { rerender } = render(
      <WalletFundPanel
        {...panelProps()}
        fundingAccount={{
          accountName: 'Default Wallet',
          accountNumber: '9000002044',
          bankName: 'FAAS (SANDBOX)',
          provider: 'piggyvest',
        }}
      />
    );
    expect(screen.getByText(/small deposit fee/)).toBeOnTheScreen();

    rerender(
      <WalletFundPanel
        {...panelProps()}
        fundingAccount={{
          accountName: 'OGB / JOHN DOE',
          accountNumber: '9814644749',
          bankName: 'Wema Bank',
          provider: 'paystack',
        }}
      />
    );
    expect(screen.queryByText(/small deposit fee/)).toBeNull();
  });
});
