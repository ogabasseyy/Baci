import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletFundModal } from './WalletFundModal';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => false,
}));

// With the server keeping PiggyVest off there is no primary verdict: the
// modal is today's legacy funding sheet, card option included.
describe('WalletFundModal with the server off', () => {
  it('shows the legacy account and keeps the card option', () => {
    render(
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={{
          armCheck: jest.fn(),
          creditedAmount: null,
          reset: jest.fn(),
          returnCtaHref: undefined,
          status: 'idle',
        }}
        fundingAccount={{
          accountName: 'OGB / JOHN DOE',
          accountNumber: '9814644749',
          bankName: 'Wema Bank',
          provider: 'paystack',
        }}
        showFundPanel
      />
    );
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeOnTheScreen();
  });
});
