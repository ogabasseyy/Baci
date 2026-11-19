import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletFundModal } from './WalletFundModal';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
jest.mock('@/hooks/use-legacy-funding-unconfirmed', () => ({
  useLegacyFundingUnconfirmed: () => false,
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => null,
}));

const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};
const account = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Provider Bank',
  provider: 'piggyvest',
};
const CARD = 'Fund with card instead';

function renderModal(
  primaryReady: boolean,
  fundReturnTo?: string,
  provider = 'piggyvest'
) {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={creditWatch}
        fundReturnTo={fundReturnTo as never}
        fundingAccount={{ ...account, provider }}
        showFundPanel
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('WalletFundModal card option with the PiggyVest wallet ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides card funding for a savings-shortfall return', () => {
    renderModal(true, '/wallet?action=savings');
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });

  it('hides card funding for a plain top-up', () => {
    renderModal(true);
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });

  it('offers only a card store credit top-up for the IMEI check return', () => {
    renderModal(true, '/imei-check');
    // IMEI checks spend store credit: the card adds it, and the PiggyVest
    // account (which funds the savings wallet) is not offered here.
    expect(screen.getByText('Add store credit')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Adds store credit for this purchase. Card top-ups have a minimum; anything extra stays as store credit.'
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('9814644749')).toBeNull();
  });

  it('keeps the start-savings return on the PiggyVest account, without card', () => {
    renderModal(true, '/wallet/savings/start');
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(screen.queryByText('Add store credit')).toBeNull();
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });

  it('offers the same store credit top-up for a utility purchase return', () => {
    renderModal(true, '/utilities/airtime?repeatAmount=500');
    expect(screen.getByText('Add store credit')).toBeOnTheScreen();
    expect(screen.queryByText('9814644749')).toBeNull();
  });

  it('keeps the account number and card toggle for legacy customers on the IMEI return', () => {
    renderModal(false, '/imei-check', 'paystack');
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: CARD })).toBeOnTheScreen();
    expect(screen.queryByText('Add store credit')).toBeNull();
  });

  it('keeps card funding for legacy customers', () => {
    renderModal(false, '/wallet?action=savings', 'paystack');
    expect(screen.getByRole('button', { name: CARD })).toBeOnTheScreen();
  });
});

describe('bugfix: card funding offered for a pending PiggyVest account', () => {
  it('hides the card option when the account is PiggyVest but the balance is pending', () => {
    // Arrange + Act: PiggyVest account, wallet not primary-ready yet.
    renderModal(false);

    // Assert: a card top-up would add store credit, not savings.
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });
});

describe('bugfix: PiggyVest account in the fund sheet not identified as savings', () => {
  it('says transfers add to the savings wallet, not store credit', () => {
    renderModal(true);

    expect(
      screen.getByText(
        /add to your savings wallet\. It doesn't add store credit/
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Copy savings account number' })
    ).toBeOnTheScreen();
  });
});
