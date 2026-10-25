import { fireEvent, render, screen } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { CheckoutPage } from './checkout-page';

/**
 * Shared fixtures/helpers for `checkout-page.wallet-funded.test.tsx`. Kept in a
 * non-`.test` module so the assertion file stays under the 300-line limit.
 * `vi.mock` declarations must remain in the test file itself (they hoist per
 * file); everything here runs against those mocks because the test imports this
 * module after registering them.
 */

export const FLAG = 'NEXT_PUBLIC_WALLET_ORDER_AUTO_DEBIT_ENABLED';
export const INTENTS_URL =
  '/api/storefront/customer/wallet/order-funding-intents';
export const SESSION_URL = '/api/storefront/auth/session';

export const ORDER_RESPONSE = {
  order: {
    id: '00000000-0000-4000-8000-0000000000a1',
    currency: 'NGN',
    tracking_token: 'track-1',
  },
  amountDueToGateway: 5000,
};

interface FetchStubOptions {
  intentResponse?: { body: unknown; status: number };
  /** Storefront cookie session — the wallet-funded gate reads this, not context. */
  sessionAuthenticated?: boolean;
}

const INTENT_BODY = {
  account: {
    accountName: 'Ada Buyer',
    accountNumber: '1234567890',
    bankName: 'Wema Bank',
    provider: 'paystack',
  },
  intent: {
    currency: 'NGN',
    expectedAmount: 5000,
    expiresAt: '2099-01-01T10:30:00.000Z',
    fundedAmount: 0,
    id: '00000000-0000-4000-8000-0000000000b1',
    orderId: ORDER_RESPONSE.order.id,
    status: 'pending',
    targetOrderAmount: 5000,
  },
};

export function stubFetch({
  intentResponse,
  sessionAuthenticated = true,
}: FetchStubOptions = {}) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const ok = (body: unknown, status = 200) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as Response;

      if (url.startsWith(SESSION_URL)) {
        return ok({ authenticated: sessionAuthenticated });
      }
      if (url === '/api/orders' && init?.method === 'POST') {
        return ok(ORDER_RESPONSE);
      }
      if (url === '/api/payments/initialize') {
        return ok({
          success: true,
          reference: 'PSK_REF_1',
          dva: {
            account_number: '9999999999',
            account_name: 'Order DVA',
            bank_name: 'Wema Bank',
            bank_code: '035',
          },
        });
      }
      if (url === INTENTS_URL) {
        return ok(
          intentResponse?.body ?? INTENT_BODY,
          intentResponse?.status ?? 200
        );
      }
      if (url.startsWith(`${INTENTS_URL}/`)) {
        return ok({ intent: INTENT_BODY.intent });
      }
      if (url.startsWith('/api/storefront/customer/wallet')) {
        return ok({ balance: 0 });
      }
      if (url.startsWith('/api/shipping/quotes')) {
        return ok({ quotes: { all: [] } });
      }
      return ok({ states: ['Lagos'], locations: [] });
    });
}

export async function placeBankTransferOrder() {
  render(<CheckoutPage />);

  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByText(/^Bank Transfer$/));

  const placeOrderButton = screen
    .getAllByRole('button', { name: /place order/i })
    .find((button) => !button.hasAttribute('disabled'));
  expect(placeOrderButton).toBeDefined();
  fireEvent.click(placeOrderButton as HTMLButtonElement);
}

export function called(
  fetchMock: ReturnType<typeof stubFetch>,
  url: string
): boolean {
  return fetchMock.mock.calls.some(([input]) => String(input) === url);
}

export async function placeOxygenOrder() {
  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Pay in Installments' }));
  fireEvent.click(await screen.findByRole('radio', { name: /Oxygen/ }));
  fireEvent.click(screen.getAllByRole('button', { name: /begin process/i }).find(button => !button.hasAttribute('disabled')) as HTMLButtonElement);
}
