import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utilityModalTestHarness as harness } from './utility-modal-test-support';
import {
  forgetPendingVtuPurchase,
  notePendingVtuReference,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
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
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      payWithWallet: true,
      setPayWithWallet: vi.fn(),
      setWalletBalance,
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
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
    // Value update (500 - 100), never an updater function (Codex
    // R109 P2: updaters must be pure).
    expect(setWalletBalance).toHaveBeenCalledWith(400);
  });

  it('says top-up is unavailable when the wallet cannot cover the bill and the store has no funding rail', async () => {
    harness.amount.current = 1000;

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Insufficient wallet balance',
        description:
          "Your wallet balance of ₦500 is ₦500 short. Wallet top-up isn't available for this store.",
        variant: 'destructive',
      });
    });
    expect(harness.checkoutFetch).not.toHaveBeenCalled();
  });

  it('opens the funding panel on insufficient balance when bank-transfer funding is available', async () => {
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
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
      getWalletBalance: () => 500,
      getWalletError: () => false,
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

  it('opens the funding panel without auto-creating a DVA on insufficient balance (consent stays with the panel CTA)', async () => {
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      fundingAccount: null,
      refreshWallet: vi.fn(),
      requiresFundingAccountConsent: true,
      setFundingAccount: vi.fn(),
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
      walletDvaEnabled: true,
      walletLoading: false,
      walletTransactions: [],
    });
    harness.amount.current = 1000;

    submitAirtimePurchase();

    // Panel opens with the manual consent CTA…
    await waitFor(() => {
      expect(screen.getByText('Get my account number')).toBeInTheDocument();
    });
    // …but no DVA provisioning request fires until the customer clicks it.
    expect(
      harness.checkoutFetch.mock.calls.some(([url]) =>
        String(url).includes('funding-account')
      )
    ).toBe(false);
  });

  it('auto-creates a DVA only after the customer explicitly picks Pay with Bank Transfer', async () => {
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      fundingAccount: null,
      refreshWallet: vi.fn(),
      requiresFundingAccountConsent: true,
      setFundingAccount: vi.fn(),
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
      walletDvaEnabled: true,
      walletLoading: false,
      walletTransactions: [],
    });

    render(
      <UtilityModal
        isOpen={true}
        onClose={harness.onClose}
      />
    );
    fireEvent.click(screen.getByText('Pay with Bank Transfer'));

    await waitFor(() => {
      expect(
        harness.checkoutFetch.mock.calls.some(([url]) =>
          String(url).includes('funding-account')
        )
      ).toBe(true);
    });
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
    // A failed vend may have restored the debit: the next balance check
    // must refetch instead of trusting the possibly-stale cache.
    const refreshWallet = vi.fn();
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      payWithWallet: true,
      refreshWallet,
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
      walletLoading: false,
    });

    submitAirtimePurchase();

    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith({
        title: 'Transaction Failed',
        description: 'Insufficient funds',
        variant: 'destructive',
      });
    });
    expect(refreshWallet).toHaveBeenCalled();
  });

  it('shows the pending screen while a checkout is processing', async () => {
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      payWithWallet: true,
      refreshWallet: vi.fn(),
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
      walletLoading: false,
    });
    harness.checkoutFetch.mockResolvedValue(
      harness.createJsonResponse({
        amount: 100,
        reference: 'REF-PROC-1',
        status: 'processing',
      })
    );

    submitAirtimePurchase();

    await waitFor(() => {
      expect(screen.getByText('Processing…')).toBeInTheDocument();
    });
    expect(screen.queryByText('Success!')).not.toBeInTheDocument();
  });

  it('locks the utility tabs while a checkout is in flight', async () => {
    harness.useWallet.mockReturnValue({
      isWalletRefreshPending: () => false,
      isWalletInitialReadPending: () => false,
      payWithWallet: true,
      refreshWallet: vi.fn(),
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      getWalletBalance: () => 500,
      getWalletError: () => false,
      walletLoading: false,
    });
    // Never resolves: the request stays in flight for the assertion.
    harness.checkoutFetch.mockImplementation(() => new Promise(() => {}));

    submitAirtimePurchase();

    // A switch here would render the result + history poll under the
    // wrong utility type (e.g. airtime polled as data, never settling).
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Data' })).toBeDisabled();
    });
    for (const name of ['Airtime', 'TV', 'Power', 'Betting']) {
      expect(screen.getByRole('tab', { name })).toBeDisabled();
    }
  });

  it('locks the utility tabs while a submit waits on the settlement gate', async () => {
    // Codex R81 P2: loading flips only AFTER the retained-settlement
    // await, so tabs used to stay enabled during the wait — a switch
    // there charged the original utility while the success view and
    // backfill followed the new tab.
    rememberPendingVtuPurchase('held-settle-scope', 'held-settle-key');
    notePendingVtuReference('held-settle-scope', 'REF-HELD');
    let releaseHistory!: (response: Response) => void;
    const historyGate = new Promise<Response>((resolve) => {
      releaseHistory = resolve;
    });
    const historyFetch = vi.fn(() => historyGate);
    vi.stubGlobal('fetch', historyFetch);
    try {
      render(<UtilityModal isOpen={true} onClose={harness.onClose} />);
      await waitFor(() => {
        expect(historyFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/vtu/history'),
          expect.anything()
        );
      });

      fireEvent.click(screen.getByText('Mock Submit'));

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Data' })).toBeDisabled();
      });
      // Still gated: the checkout must not have dispatched yet.
      expect(harness.checkoutFetch).not.toHaveBeenCalled();

      releaseHistory({
        ok: true,
        status: 200,
        json: async () => ({ transactions: [] }),
      } as Response);
      await waitFor(() => {
        expect(screen.getByText('Success!')).toBeInTheDocument();
      });
    } finally {
      vi.unstubAllGlobals();
      forgetPendingVtuPurchase('held-settle-scope');
    }
  });

  it('keeps the utility tabs locked on the processing view after loading settles', async () => {
    // loading flips false while step is still 'processing': an enabled
    // tab switch would unmount the settlement poll (key never settles,
    // wallet never refetches, late token/refund never surfaces).
    harness.checkoutFetch.mockResolvedValue(
      harness.createJsonResponse({
        amount: 100,
        reference: 'REF-PROC-2',
        status: 'processing',
      })
    );

    submitAirtimePurchase();

    await waitFor(() => {
      expect(screen.getByText('Processing…')).toBeInTheDocument();
    });
    for (const name of ['Airtime', 'Data', 'TV', 'Power', 'Betting']) {
      expect(screen.getByRole('tab', { name })).toBeDisabled();
    }
    // fireEvent bypasses native disabled, so this also exercises the
    // onSelect step guard: the processing view must survive the click.
    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));

    expect(screen.getByText('Processing…')).toBeInTheDocument();
    expect(screen.queryByTestId('airtime-data-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bill-payment-form')).not.toBeInTheDocument();
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
