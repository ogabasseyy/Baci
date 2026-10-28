import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditDirectCheckoutReference } from '@/lib/credit-direct-client';
import {
  mockOpenCreditDirectCheckout,
  mockPush,
  resetBnplLauncherTestState,
} from './bnpl-launcher.test-setup';
import { BnplLauncher } from './bnpl-launcher';
import { readCreditDirectPopupMarker } from './checkout/credit-direct-popup-return';

describe('BnplLauncher Credit Direct in-page success', () => {
  beforeEach(() => {
    resetBnplLauncherTestState();
  });

  afterAll(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('verifies an in-page Credit Direct success before redirecting', async () => {
    let completeCheckout:
      | ((reference: CreditDirectCheckoutReference) => void)
      | undefined;
    mockOpenCreditDirectCheckout.mockImplementation(({ onSuccess }) => {
      completeCheckout = onSuccess;
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(
      () => expect(mockOpenCreditDirectCheckout).toHaveBeenCalledOnce(),
      { timeout: 5_000 }
    );
    expect(completeCheckout).toEqual(expect.any(Function));
    act(() => {
      completeCheckout?.({
        checkoutTransactionId: 'ref-1',
        sessionId: 'signed-session-1',
      });
    });

    expect(
      await screen.findByRole('heading', { name: 'Confirming your payment' })
    ).toBeInTheDocument();
    expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe('ref-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order-1',
          checkoutTransactionId: 'ref-1',
          customerEmail: 'customer@example.com',
          sessionId: 'signed-session-1',
          tracking_token: 'track-order-token',
        }),
      }
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
