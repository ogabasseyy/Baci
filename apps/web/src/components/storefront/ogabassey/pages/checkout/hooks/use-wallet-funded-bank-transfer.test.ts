import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startMock = vi.hoisted(() => vi.fn());
const getIntentMock = vi.hoisted(() => vi.fn());

vi.mock('../wallet-funded-bank-transfer', () => ({
  startWalletFundedBankTransfer: startMock,
}));

vi.mock('@/lib/order-wallet-funding-intent-client', () => ({
  getOrderWalletFundingIntent: getIntentMock,
}));

import { useWalletFundedBankTransfer } from './use-wallet-funded-bank-transfer';

const INTENT = {
  currency: 'NGN',
  expectedAmount: 5000,
  expiresAt: '2026-07-13T10:30:00.000Z',
  fundedAmount: 0,
  id: 'intent-1',
  orderId: 'order-1',
  status: 'pending' as const,
  targetOrderAmount: 5000,
};

const ACCOUNT = {
  accountName: 'Ada Buyer',
  accountNumber: '1234567890',
  bankName: 'Wema Bank',
  provider: 'paystack' as const,
};

const START_ARGS = {
  checkoutFingerprint: 'fingerprint-1',
  currency: 'NGN',
  merchantId: 'merchant-1',
  merchantSlug: 'test-store',
  orderId: 'order-1',
  orderNumber: 'ORD-1',
  trackingToken: 'track-1',
};

function renderWalletTransfer() {
  const onOrderPaid = vi.fn();
  const view = renderHook(() =>
    useWalletFundedBankTransfer({
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      onOrderPaid,
    })
  );
  return { onOrderPaid, view };
}

describe('useWalletFundedBankTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIntentMock.mockResolvedValue(INTENT);
  });

  it('resolves `fallback` and opens no modal when the intent API declines', async () => {
    startMock.mockResolvedValue({
      code: 'WALLET_ORDER_AUTO_DEBIT_DISABLED',
      kind: 'fallback',
      message: 'disabled',
    });

    const { view } = renderWalletTransfer();

    let started: unknown;
    await act(async () => {
      started = await view.result.current.start(START_ARGS);
    });

    expect(started).toBe('fallback');
    expect(view.result.current.account).toBeNull();
    expect(view.result.current.intent).toBeNull();
    expect(getIntentMock).not.toHaveBeenCalled();
  });

  it('resolves `uncertain` and opens no modal on an indeterminate create', async () => {
    // Money-safety: an indeterminate create must NOT be treated as `started`
    // (no session/modal, the intent may not exist) NOR as `fallback` (the
    // caller would open the legacy path and risk a double charge).
    startMock.mockResolvedValue({
      code: 'server_error',
      kind: 'uncertain',
      message: 'unconfirmed',
    });

    const { view } = renderWalletTransfer();

    let started: unknown;
    await act(async () => {
      started = await view.result.current.start(START_ARGS);
    });

    expect(started).toBe('uncertain');
    expect(view.result.current.account).toBeNull();
    expect(view.result.current.intent).toBeNull();
    expect(getIntentMock).not.toHaveBeenCalled();
  });

  it('opens the transfer session and starts polling on success', async () => {
    startMock.mockResolvedValue({ account: ACCOUNT, intent: INTENT, kind: 'intent' });

    const { view } = renderWalletTransfer();

    let started: unknown;
    await act(async () => {
      started = await view.result.current.start(START_ARGS);
    });

    expect(started).toEqual({ status: 'started', intentId: 'intent-1' });
    expect(view.result.current.account).toEqual(ACCOUNT);
    await waitFor(() => {
      expect(getIntentMock).toHaveBeenCalledWith({
        intentId: 'intent-1',
        merchantId: 'merchant-1',
        merchantSlug: 'test-store',
      });
    });
  });

  it('hands the order back to the checkout only when the intent completes', async () => {
    startMock.mockResolvedValue({ account: ACCOUNT, intent: INTENT, kind: 'intent' });
    getIntentMock.mockResolvedValue({
      ...INTENT,
      fundedAmount: 5000,
      orderPaid: true,
      status: 'completed',
    });

    const { onOrderPaid, view } = renderWalletTransfer();

    await act(async () => {
      await view.result.current.start(START_ARGS);
    });

    await waitFor(() => {
      expect(onOrderPaid).toHaveBeenCalledWith({
        checkoutFingerprint: 'fingerprint-1',
        currency: 'NGN',
        intentId: 'intent-1',
        orderId: 'order-1',
        orderNumber: 'ORD-1',
        total: 5000,
        trackingToken: 'track-1',
      });
    });
  });

  it('does not pay the order out on an ambiguous transfer', async () => {
    startMock.mockResolvedValue({ account: ACCOUNT, intent: INTENT, kind: 'intent' });
    getIntentMock.mockResolvedValue({ ...INTENT, status: 'review_required' });

    const { onOrderPaid, view } = renderWalletTransfer();

    await act(async () => {
      await view.result.current.start(START_ARGS);
    });

    await waitFor(() => {
      expect(view.result.current.intent?.status).toBe('review_required');
    });
    expect(onOrderPaid).not.toHaveBeenCalled();
  });

  it('surfaces the consent prompt and resolves it from the dialog', async () => {
    startMock.mockImplementation(
      async ({ requestConsent }: { requestConsent: () => Promise<boolean> }) => {
        const granted = await requestConsent();
        return granted
          ? { account: ACCOUNT, intent: INTENT, kind: 'intent' }
          : { code: 'WALLET_CONSENT_DENIED', kind: 'fallback', message: 'denied' };
      }
    );

    const { view } = renderWalletTransfer();

    let startedPromise: Promise<unknown> | undefined;
    await act(async () => {
      startedPromise = view.result.current.start(START_ARGS);
    });

    await waitFor(() => {
      expect(view.result.current.consentRequested).toBe(true);
    });

    await act(async () => {
      view.result.current.acceptConsent();
    });

    await expect(startedPromise).resolves.toEqual({
      status: 'started',
      intentId: 'intent-1',
    });
    expect(view.result.current.consentRequested).toBe(false);
  });

  it('resolves start() `fallback` and clears the prompt when consent is declined', async () => {
    startMock.mockImplementation(
      async ({ requestConsent }: { requestConsent: () => Promise<boolean> }) => {
        const granted = await requestConsent();
        return granted
          ? { account: ACCOUNT, intent: INTENT, kind: 'intent' }
          : { code: 'WALLET_CONSENT_DENIED', kind: 'fallback', message: 'denied' };
      }
    );

    const { view } = renderWalletTransfer();

    let startedPromise: Promise<unknown> | undefined;
    await act(async () => {
      startedPromise = view.result.current.start(START_ARGS);
    });

    await waitFor(() => {
      expect(view.result.current.consentRequested).toBe(true);
    });

    await act(async () => {
      view.result.current.declineConsent();
    });

    // Declining is a definite decline: start() resolves `fallback` so the
    // caller runs the legacy path, and the prompt is dismissed.
    await expect(startedPromise).resolves.toBe('fallback');
    expect(view.result.current.consentRequested).toBe(false);
  });

  it('closing the modal ends the session', async () => {
    startMock.mockResolvedValue({ account: ACCOUNT, intent: INTENT, kind: 'intent' });

    const { view } = renderWalletTransfer();

    await act(async () => {
      await view.result.current.start(START_ARGS);
    });
    act(() => {
      view.result.current.close();
    });

    expect(view.result.current.account).toBeNull();
  });
});
