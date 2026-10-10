import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utilityModalTestHarness as harness } from './utility-modal-test-support';
import { UtilityModal } from './UtilityModal';

function submitAirtimePurchase() {
  render(
    <UtilityModal
      isOpen={true}
      onClose={harness.onClose}
    />
  );
  fireEvent.click(screen.getByText('Mock Submit'));
}

describe('UtilityModal checkout routing', () => {
  beforeEach(() => {
    harness.reset();
  });

  it('sends full wallet coverage to wallet-only checkout with idempotency', async () => {
    const setWalletBalance = vi.fn();
    harness.useWallet.mockReturnValue({
      payWithWallet: true,
      setPayWithWallet: vi.fn(),
      setWalletBalance,
      walletBalance: 500,
      walletLoading: false,
    });

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.checkoutFetch).toHaveBeenCalledWith(
        '/api/vtu/checkout/wallet-only',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Idempotency-Key': expect.any(String) },
          body: expect.any(String),
        })
      );
    });
    expect(JSON.parse(String(harness.checkoutFetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      amount: 100,
      merchantSlug: 'ogabassey',
      type: 'airtime',
      walletAmount: 100,
    });
    expect(setWalletBalance).toHaveBeenCalledWith(expect.any(Function));
    const applyBalanceUpdate = setWalletBalance.mock.calls[0]?.[0];
    expect(typeof applyBalanceUpdate).toBe('function');
    expect((applyBalanceUpdate as (balance: number) => number)(500)).toBe(400);
  });

  it('blocks checkout without a network call when the wallet cannot cover the bill', async () => {
    harness.amount.current = 1000;

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Insufficient wallet balance',
        description:
          'Fund your wallet with at least ₦500 more to complete this purchase.',
        variant: 'destructive',
      });
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
  });

  it('opens the funding panel on insufficient balance when bank-transfer funding is available', async () => {
    harness.useWallet.mockReturnValue({
      fundingAccount: {
        accountName: 'OGB / TEST',
        accountNumber: '9099887766',
        bankName: 'Wema Bank',
        provider: 'paystack',
      },
      refreshWallet: vi.fn(),
      requiresFundingAccountConsent: false,
      setFundingAccount: vi.fn(),
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      walletDvaEnabled: true,
      walletLoading: false,
      walletTransactions: [],
    });
    harness.amount.current = 1000;

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Insufficient wallet balance' })
      );
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
    expect(screen.getByText('9099887766')).toBeInTheDocument();
  });

  it('requires a signed-in customer before starting checkout', async () => {
    harness.useAuth.mockReturnValue({
      customer: null,
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Sign in required',
        description: 'Please sign in to use utility checkout.',
        variant: 'destructive',
      });
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
  });

  it('treats a missing CustomerAuthProvider as a signed-out customer', async () => {
    harness.useAuth.mockReturnValue(null);

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Sign in required',
        description: 'Please sign in to use utility checkout.',
        variant: 'destructive',
      });
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
  });

  it('waits for authentication resolution before starting checkout', async () => {
    harness.useAuth.mockReturnValue({
      customer: null,
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Checking account',
        description: 'Please wait while we confirm your session.',
      });
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
  });

  it('surfaces JSON checkout failures', async () => {
    harness.checkoutFetch.mockResolvedValue(
      harness.createJsonResponse({ error: 'Insufficient funds' }, { ok: false, status: 400 })
    );

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Transaction Failed',
        description: 'Insufficient funds',
        variant: 'destructive',
      });
    });
  });

  it('rejects failed non-JSON checkout responses', async () => {
    harness.checkoutFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html>Bad gateway</html>'),
    } as Response);

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Transaction Failed',
        description: 'Payment checkout failed (502)',
        variant: 'destructive',
      });
    });
    expect(screen.queryByText('Success!')).not.toBeInTheDocument();
  });

  it('reuses a wallet idempotency key when retrying the same failed purchase', async () => {
    harness.checkoutFetch.mockResolvedValue(
      harness.createJsonResponse({ error: 'Retry later' }, { ok: false, status: 500 })
    );

    submitAirtimePurchase();
    await waitFor(() => expect(harness.checkoutFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Mock Submit'));
    await waitFor(() => expect(harness.checkoutFetch).toHaveBeenCalledTimes(2));

    expect(harness.checkoutFetch.mock.calls[0]?.[0]).toBe(
      '/api/vtu/checkout/wallet-only'
    );
    expect(harness.checkoutFetch.mock.calls[1]?.[0]).toBe(
      '/api/vtu/checkout/wallet-only'
    );
    expect(harness.checkoutFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': expect.any(String),
    });
    expect(harness.checkoutFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': expect.any(String),
    });
    expect(harness.checkoutFetch.mock.calls[0]?.[1]?.headers).toEqual(
      harness.checkoutFetch.mock.calls[1]?.[1]?.headers
    );
  });

  it('creates a fresh wallet idempotency key when the purchase payload changes', async () => {
    harness.checkoutFetch.mockResolvedValue(
      harness.createJsonResponse({ error: 'Retry later' }, { ok: false, status: 500 })
    );

    submitAirtimePurchase();
    await waitFor(() => expect(harness.checkoutFetch).toHaveBeenCalledTimes(1));
    harness.amount.current = 200;
    fireEvent.click(screen.getByText('Mock Submit'));
    await waitFor(() => expect(harness.checkoutFetch).toHaveBeenCalledTimes(2));

    expect(harness.checkoutFetch.mock.calls[0]?.[1]?.headers).not.toEqual(
      harness.checkoutFetch.mock.calls[1]?.[1]?.headers
    );
  });
});
