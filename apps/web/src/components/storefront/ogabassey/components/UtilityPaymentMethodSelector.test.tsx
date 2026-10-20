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
        walletSelected={true}
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
        walletSelected={true}
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
        walletSelected={true}
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
        walletSelected={false}
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
        walletSelected={false}
        walletLoading={false}
      />
    );

    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toHaveAttribute('aria-checked', 'false');
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
        walletSelected={false}
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
        walletSelected={false}
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
        walletSelected={true}
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
        walletSelected={true}
        walletLoading={false}
      />
    );

    expect(
      screen.getByRole('radio', { name: /pay with wallet/i })
    ).toBeDisabled();
  });

  it('announces selection separately from eligibility', () => {
    // Muse R132: aria-checked tracks payWithWallet (selection), not
    // canUseWallet (eligibility) — an eligible but unselected wallet
    // must not announce as checked, and the selected styling follows
    // the same state.
    const { rerender } = render(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletSelected={false}
        walletLoading={false}
      />
    );

    const unselected = screen.getByRole('radio', {
      name: /pay with wallet/i,
    });
    expect(unselected).toHaveAttribute('aria-checked', 'false');
    expect(unselected.className).toContain('border-gray-200');
    expect(unselected.className).not.toContain('border-store-primary');

    rerender(
      <UtilityPaymentMethodSelector
        canUseWallet={true}
        isLoading={false}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={500}
        walletSelected={true}
        walletLoading={false}
      />
    );

    const selected = screen.getByRole('radio', {
      name: /pay with wallet/i,
    });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(selected.className).toContain('border-store-primary');
  });

  it('shows unavailable instead of the funding hint when the balance fetch failed (Codex R143 P2)', () => {
    render(
      <UtilityPaymentMethodSelector
        canUseWallet={false}
        isLoading={false}
        onFundWallet={vi.fn()}
        onSelectWallet={vi.fn()}
        showWalletRow={true}
        walletBalance={0}
        walletError={true}
        walletSelected={false}
        walletLoading={false}
      />
    );

    // The balance is unknown, not zero: no funding hint, no funding
    // CTA — only the unavailable state.
    expect(
      screen.getByText(/could not load your wallet balance/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/fund your wallet to pay without card fees/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /pay with bank transfer/i })
    ).not.toBeInTheDocument();
  });
});
