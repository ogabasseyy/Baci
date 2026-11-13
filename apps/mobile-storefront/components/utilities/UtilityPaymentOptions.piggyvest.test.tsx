import { render, screen } from '@testing-library/react-native';
import { UtilityPaymentOptions } from '@/components/utilities/UtilityPaymentOptions';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

const RETURN_TO = '/utilities/airtime' as WalletReturnHref;

function renderOptions(amount: number) {
  return render(
    <UtilityPaymentOptions
      amount={amount}
      returnToHref={RETURN_TO}
      walletBalance={0}
      walletIsLoading={false}
      walletIsSettled
      walletIsStoreCredit
    />
  );
}

beforeEach(() =>
  useVtuWalletPayStore.setState({
    covers: () => false,
    balanceKobo: null,
    pending: null,
  })
);

describe('bugfix: airtime never offered a ready PiggyVest wallet (Fable walk)', () => {
  it('shows the savings wallet as the payment method when it pays', () => {
    useVtuWalletPayStore.setState({
      covers: (amount) => amount <= 549_700,
      balanceKobo: 54_970_000,
    });
    renderOptions(100);
    expect(screen.getByText('Savings wallet · NGN')).toBeTruthy();
    expect(
      screen.getByText('₦549,700 available · covers this purchase')
    ).toBeTruthy();
    expect(screen.queryByText(/not enough store credit/i)).toBeNull();
    expect(screen.queryByText(/more needed/i)).toBeNull();
  });

  it('bugfix: says the savings balance and real shortfall above it (Fable walk)', () => {
    useVtuWalletPayStore.setState({
      covers: (amount) => amount <= 549_700,
      balanceKobo: 54_970_000,
    });
    renderOptions(1_000_000);
    expect(screen.getByText('Savings wallet · NGN')).toBeTruthy();
    expect(
      screen.getByText('₦549,700 available · ₦450,300 more needed')
    ).toBeTruthy();
  });

  it('bugfix: shows the savings wallet before an amount is chosen (Fable walk)', () => {
    useVtuWalletPayStore.setState({
      covers: (amount) => amount <= 549_700,
      balanceKobo: 54_970_000,
    });
    renderOptions(0);
    expect(screen.getByText('Savings wallet · NGN')).toBeTruthy();
    expect(screen.getByText('₦549,700 available')).toBeTruthy();
    expect(screen.queryByText(/Pay with store credit/)).toBeNull();
  });

  it('shows nothing new for a customer with no PiggyVest wallet (other merchants)', () => {
    render(
      <UtilityPaymentOptions
        amount={100}
        returnToHref={RETURN_TO}
        walletBalance={0}
        walletIsLoading={false}
        walletIsSettled
      />
    );
    expect(screen.queryByText('Savings wallet · NGN')).toBeNull();
    expect(screen.getByText('Pay with wallet')).toBeTruthy();
  });
});

describe('bugfix: the savings wallet showed while a store credit replay was pending (Codex P2)', () => {
  it('never shows the savings wallet for a purchase with a retained store credit attempt', () => {
    useVtuWalletPayStore.setState({
      covers: () => true,
      balanceKobo: 54_970_000,
    });
    render(
      <UtilityPaymentOptions
        amount={100}
        returnToHref={RETURN_TO}
        walletBalance={0}
        walletIsLoading={false}
        walletIsSettled
        walletIsStoreCredit
        retainedStoreCredit
      />
    );
    expect(screen.queryByText('Savings wallet · NGN')).toBeNull();
  });
});

describe('bugfix: a kept PiggyVest attempt showed store credit as the method (Codex P2)', () => {
  it('shows PiggyVest as the method even when it no longer covers the amount', () => {
    useVtuWalletPayStore.setState({ covers: () => false, balanceKobo: 10_000 });
    render(
      <UtilityPaymentOptions
        amount={500}
        returnToHref={RETURN_TO}
        walletBalance={1_000}
        walletIsLoading={false}
        walletIsSettled
        walletIsStoreCredit
        retainedPiggyvest
      />
    );
    expect(screen.getByText('Savings wallet · NGN')).toBeTruthy();
  });
});
