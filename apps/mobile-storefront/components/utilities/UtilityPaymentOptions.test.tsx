import { render, screen } from '@testing-library/react-native';
import { UtilityPaymentOptions } from '@/components/utilities/UtilityPaymentOptions';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

const RETURN_TO_HREF = '/utilities/tv?repeatAmount=1000' as WalletReturnHref;

describe('UtilityPaymentOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the wallet balance as the only payment method', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletBalance={1500}
        walletIsLoading={false}
      />
    );

    expect(screen.getByText('Payment Method')).toBeTruthy();
    expect(screen.getByText('Pay with wallet')).toBeTruthy();
    expect(screen.getByText(/₦1,500 available/i)).toBeTruthy();
    expect(screen.queryByText(/pay with card/i)).toBeNull();
    expect(screen.queryByText(/korapay/i)).toBeNull();
  });

  it('marks the wallet selected when it covers the bill', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletBalance={1500}
        walletIsLoading={false}
      />
    );

    const walletRow = screen.getByLabelText(/pay with wallet/i);
    expect(walletRow.props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByText(/covers this purchase/i)).toBeTruthy();
  });

  it('shows the shortfall when the balance cannot cover the bill', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletBalance={200}
        walletIsLoading={false}
      />
    );

    const walletRow = screen.getByLabelText(/pay with wallet/i);
    expect(walletRow.props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(screen.getByText(/₦800 more needed/i)).toBeTruthy();
  });

  it('shows a loading state while the wallet balance loads', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletIsLoading={true}
      />
    );

    expect(screen.getByText(/checking wallet balance/i)).toBeTruthy();
    expect(screen.queryByText('Pay with wallet')).toBeNull();
  });

  it('shows an error state when the wallet lookup fails', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletError={new Error('wallet unavailable')}
        walletIsLoading={false}
      />
    );

    expect(screen.getByText('Wallet unavailable')).toBeTruthy();
    expect(screen.queryByText('Pay with wallet')).toBeNull();
  });

  it('shows the error state, not a spinner, when the first wallet fetch fails unsettled (Codex R143 P2)', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletError={new Error('wallet unavailable')}
        walletIsLoading={false}
        walletIsSettled={false}
      />
    );

    // Without the precedence fix, isChecking swallows the error and
    // the section spins indefinitely.
    expect(screen.getByText('Wallet unavailable')).toBeTruthy();
    expect(screen.queryByText(/checking wallet balance/i)).toBeNull();
  });

  it('renders the bank-transfer nudge when eligible and the balance is short', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        canFundByBankTransfer={true}
        returnToHref={RETURN_TO_HREF}
        walletBalance={200}
        walletIsLoading={false}
      />
    );

    expect(
      screen.getByText(/transfers to your wallet account number cost 1%/i)
    ).toBeTruthy();
  });

  it('hides the bank-transfer nudge when the merchant has no wallet DVA (gated off)', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        canFundByBankTransfer={false}
        returnToHref={RETURN_TO_HREF}
        walletBalance={200}
        walletIsLoading={false}
      />
    );

    expect(
      screen.queryByText(/transfers to your wallet account number/i)
    ).toBeNull();
  });

  it('hides the bank-transfer nudge when the wallet already covers the bill', () => {
    render(
      <UtilityPaymentOptions
        amount={1000}
        canFundByBankTransfer={true}
        returnToHref={RETURN_TO_HREF}
        walletBalance={1500}
        walletIsLoading={false}
      />
    );

    expect(
      screen.queryByText(/transfers to your wallet account number/i)
    ).toBeNull();
  });

  it('shows checking (not ₦0) while the wallet query is unsettled', () => {
    // Codex R130 P2: a disabled query reports isLoading=false with no
    // data during hydration/account switch — rendering that as ₦0
    // with a full shortfall is a false empty-wallet state.
    render(
      <UtilityPaymentOptions
        amount={1000}
        canFundByBankTransfer={true}
        returnToHref={RETURN_TO_HREF}
        walletIsLoading={false}
        walletIsSettled={false}
      />
    );

    expect(screen.getByText(/checking wallet balance/i)).toBeTruthy();
    expect(screen.queryByText('Pay with wallet')).toBeNull();
    expect(screen.queryByText(/₦0 available/i)).toBeNull();
    expect(
      screen.queryByText(/transfers to your wallet account number/i)
    ).toBeNull();
  });

  it('shows checking while unsettled even with a stale cached balance', () => {
    // The cached figure belongs to the previous owner/session until
    // the new identity's query settles — never render it as current.
    render(
      <UtilityPaymentOptions
        amount={1000}
        returnToHref={RETURN_TO_HREF}
        walletBalance={5000}
        walletIsLoading={false}
        walletIsSettled={false}
      />
    );

    expect(screen.getByText(/checking wallet balance/i)).toBeTruthy();
    expect(screen.queryByText(/₦5,000 available/i)).toBeNull();
  });
});
