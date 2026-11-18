import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  WalletOrderFundingIntent,
  WalletOrderFundingIntentStatus,
} from '@/schemas/order-wallet-funding-intent';
import { WalletFundedTransferModal } from './WalletFundedTransferModal';

const ACCOUNT = {
  accountName: 'Ada Buyer',
  accountNumber: '1234567890',
  bankName: 'Wema Bank',
  provider: 'paystack' as const,
};

const BASE_INTENT: WalletOrderFundingIntent = {
  currency: 'NGN',
  expectedAmount: 5000,
  expiresAt: '2026-07-13T10:30:00.000Z',
  fundedAmount: 0,
  id: 'intent-1',
  orderId: 'order-1',
  status: 'pending',
  targetOrderAmount: 5000,
};

function renderModal(
  intentOverrides: Partial<WalletOrderFundingIntent> & {
    status?: WalletOrderFundingIntentStatus;
  } = {},
  props: Partial<React.ComponentProps<typeof WalletFundedTransferModal>> = {}
) {
  const onCheckNow = vi.fn();
  const onClose = vi.fn();
  const onCopy = vi.fn();
  render(
    <WalletFundedTransferModal
      account={ACCOUNT}
      copiedText={null}
      error={null}
      formatCurrency={(amount) => `NGN ${amount.toFixed(2)}`}
      intent={{ ...BASE_INTENT, ...intentOverrides }}
      isChecking={false}
      onCheckNow={onCheckNow}
      onClose={onClose}
      onCopy={onCopy}
      {...props}
    />
  );
  return { onCheckNow, onClose, onCopy };
}

describe('WalletFundedTransferModal', () => {
  it('shows the wallet account number and the amount still to send', () => {
    renderModal();

    expect(screen.getByText('1234567890')).toBeDefined();
    expect(screen.getByText('Wema Bank')).toBeDefined();
    expect(screen.getByText('NGN 5000.00')).toBeDefined();
    expect(screen.getByText('Waiting for your transfer')).toBeDefined();
  });

  it('copies the account number', () => {
    const { onCopy } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: /copy account number/i }));

    expect(onCopy).toHaveBeenCalledWith('1234567890');
  });

  it('shows what is still owed on a partial transfer and never says paid', () => {
    renderModal({
      fundedAmount: 2000,
      remainingAmount: 3000,
      status: 'underfunded',
    });

    expect(screen.getByText('Part of your transfer landed')).toBeDefined();
    expect(screen.getByText('NGN 3000.00')).toBeDefined();
    expect(screen.queryByText('Order paid')).toBeNull();
    // The account stays on screen so the customer can top the transfer up.
    expect(screen.getByText('1234567890')).toBeDefined();
  });

  it('tells the customer an ambiguous transfer is under review, not paid', () => {
    renderModal({ status: 'review_required' });

    expect(screen.getByText('We are checking your transfer')).toBeDefined();
    expect(screen.queryByText('Order paid')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /check now/i })
    ).toBeNull();
  });

  it('reports a completed intent as paid', () => {
    renderModal({ fundedAmount: 5000, orderPaid: true, status: 'completed' });

    expect(screen.getByText('Order paid')).toBeDefined();
  });

  it('stops offering a manual check once the window has expired', () => {
    renderModal({ status: 'expired' });

    expect(screen.getByText('Transfer window expired')).toBeDefined();
    expect(screen.queryByRole('button', { name: /check now/i })).toBeNull();
  });

  it('runs a manual check and closes on demand', () => {
    const { onCheckNow, onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: /check now/i }));
    fireEvent.click(screen.getByRole('button', { name: /close and check later/i }));

    expect(onCheckNow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the manual check while a poll is in flight', () => {
    renderModal({}, { isChecking: true });

    expect(
      screen.getByRole('button', { name: /checking/i }).hasAttribute('disabled')
    ).toBe(true);
  });

  it('explains a poll transport failure without alarming about the money', () => {
    renderModal({}, { error: 'offline' });

    expect(screen.getByText(/your money is not affected/i)).toBeDefined();
    expect(screen.getByText(/we will keep trying/i)).toBeDefined();
  });

  it('does not promise automatic retries when polling is exhausted', () => {
    renderModal({}, { error: 'offline', pollingExhausted: true });

    expect(
      screen.getByText(/Auto-refresh paused — tap below to check transfer status\./i)
    ).toBeDefined();
    expect(screen.getByText(/your money is not affected/i)).toBeDefined();
    expect(screen.queryByText(/we will keep trying/i)).toBeNull();
  });
});
