import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UtilityPaymentMethodSelector } from './UtilityPaymentMethodSelector';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('UtilityPaymentMethodSelector', () => {
  it('selects wallet when a balance is available', async () => {
    const user = userEvent.setup();
    const onSelectWallet = vi.fn();

    render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={onSelectWallet}
        showWalletRow={true}
        walletBalance={500}
        walletLoading={false}
      />
    );

    await user.click(screen.getByRole('radio', { name: /pay with wallet/i }));

    expect(onSelectWallet).toHaveBeenCalledOnce();
    expect(screen.getByText(/500 available/i)).toBeInTheDocument();
  });

  it('marks the wallet option as recommended', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletLoading={false}
      />
    );

    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('offers no card option: wallet is the only payment method', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletLoading={false}
      />
    );

    expect(
      screen.queryByRole('radio', { name: /pay with card/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a disabled wallet option while its balance is loading', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={false}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={false}
        walletBalance={0}
        walletLoading={true}
      />
    );

    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toBeDisabled();
    expect(screen.getByText(/checking wallet balance/i)).toBeInTheDocument();
  });

  it('shows a disabled wallet option with a funding hint at zero balance', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={false}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={0}
        walletLoading={false}
      />
    );

    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toBeDisabled();
    expect(
      screen.getByText(/fund your wallet to pay without card fees/i)
    ).toBeInTheDocument();
  });

  it('prompts signed-out customers to sign in and fund instead of showing a wallet row', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={false}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={false}
        walletBalance={0}
        walletLoading={false}
      />
    );

    expect(
      screen.queryByRole('radio', { name: /pay with wallet/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/sign in and fund your wallet/i)
    ).toBeInTheDocument();
  });

  it('invokes onFundWallet from the Pay with Bank Transfer option', async () => {
    const user = userEvent.setup();
    const onFundWallet = vi.fn();

    render(
      <UtilityPaymentMethodSelector
        canUseWallet={false}
        isLoading={false}
        onFundWallet={onFundWallet}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={0}
        walletLoading={false}
      />
    );

    await user.click(
      screen.getByRole('button', { name: /pay with bank transfer/i })
    );

    expect(onFundWallet).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/1% fee, max ₦300/i)
    ).toBeInTheDocument();
  });

  it('hides the bank-transfer option when onFundWallet is not provided', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletLoading={false}
      />
    );

    expect(
      screen.queryByRole('button', { name: /pay with bank transfer/i })
    ).not.toBeInTheDocument();
  });

  it('disables the wallet method while a checkout request is pending', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={true}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletLoading={false}
      />
    );

    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toBeDisabled();
  });
});
