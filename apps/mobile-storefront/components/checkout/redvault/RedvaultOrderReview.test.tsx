import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { createOrder } from '@/services/orders';
import { getRedvaultPaymentAvailability } from '@/services/redvault';
import { RedvaultOrderReview } from './RedvaultOrderReview';
import {
  redvaultOrderRequest as request,
  redvaultOrderResponse as responseBody,
} from './redvault-order-review.test-utils';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/services/orders-auth', () => ({
  resolveCheckoutAuth: async () => ({
    authorizationHeaders: { Authorization: 'Bearer customer-token' },
    canValidateUser: false,
    session: null,
  }),
}));
jest.mock('@/services/read-checkout-stored-session', () => ({
  readCheckoutStoredSession: async () => ({ session: null, timedOut: false }),
}));
jest.mock('@/lib/resolve-checkout-auth-partition', () => ({
  resolveCheckoutAuthPartition: async () => 'guest',
}));
jest.mock('@/lib/checkout-attempt-key', () => ({
  getCheckoutAttemptKey: async (_payload: unknown, generation: string) =>
    generation,
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ checkoutGeneration: 'cart-one' }) },
}));
jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true }),
}));
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        apiUrl: 'https://ogabassey.example',
      },
    },
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: {} },
  supabaseAuthStorage: {},
  supabaseAuthStorageKey: 'test',
}));
jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
  trackError: jest.fn(),
}));

const mockFetch = jest.fn<typeof fetch>();
let initializationStatus = 200;
let orderBody: unknown = responseBody;
beforeEach(() => {
  jest.clearAllMocks();
  initializationStatus = 200;
  orderBody = responseBody;
  global.fetch = mockFetch;
  mockFetch.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith('/availability')
      ? { available: true, reason: 'ready' }
      : path === '/api/orders'
        ? orderBody
        : initializationStatus === 202
          ? { code: 'REDVAULT_RECONCILIATION_REQUIRED' }
          : {
              success: true,
              authorization_url: 'https://checkout.paystack.com/test',
              reference: 'RV-test',
            };
    return {
      ok: path.endsWith('/initialize') ? initializationStatus < 400 : true,
      status: path.endsWith('/initialize') ? initializationStatus : 200,
      headers: new Headers(),
      json: async () => body,
      clone: () => ({ json: async () => body }),
    } as Response;
  });
});

async function mountReview() {
  expect(
    await getRedvaultPaymentAvailability('6b5cb8a4-5575-456c-b936-8cdfae30db74')
  ).toBe(true);
  const orderResponse = await createOrder(request);
  const onClose = jest.fn();
  render(
    <RedvaultOrderReview
      input={{
        orderResponse,
        customerEmail: request.customer_email,
        customerName: request.customer_name,
        customerPhone: request.customer_phone,
      }}
      onClose={onClose}
    />
  );
  return onClose;
}

it('creates a protected order, displays only persisted totals, then opens Paystack', async () => {
  await mountReview();
  expect(screen.getByText('₦117.50')).toBeTruthy();
  expect(screen.getByText('₦110.00')).toBeTruthy();
  expect(screen.getByText('₦100.00')).toBeTruthy();
  expect(screen.getByText('₦10.00')).toBeTruthy();
  expect(screen.getByText('₦7.50')).toBeTruthy();
  expect(screen.getByText('-₦5.00')).toBeTruthy();
  expect(screen.getByText('₦0.00')).toBeTruthy();
  expect(screen.queryByText('₦999.00')).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Continue to secure UBA payment' })
  );
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/payment-gateway',
        params: expect.objectContaining({
          gateway: 'paystack',
          paymentMethod: 'uba_redvault',
          amount: '117.5',
        }),
      })
    )
  );
  const init = mockFetch.mock.calls.find(([url]) =>
    String(url).endsWith('/initialize')
  )?.[1];
  expect(JSON.parse(String(init?.body))).toMatchObject({
    payment_method: 'uba_redvault',
    gateway: 'paystack',
  });
  expect(init?.headers).toMatchObject({
    Authorization: 'Bearer customer-token',
  });
  const order = mockFetch.mock.calls.find(([url]) =>
    String(url).endsWith('/orders')
  )?.[1];
  expect(order?.headers).toMatchObject({
    'Idempotency-Key': 'cart-one:uba_redvault',
  });
});

it('keeps initialization 202 pending without received copy or a repeat-payment action', async () => {
  initializationStatus = 202;
  const onClose = await mountReview();
  fireEvent.press(
    screen.getByRole('button', { name: 'Continue to secure UBA payment' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(/Payment initialization needs confirmation/)
    ).toBeTruthy()
  );
  expect(screen.queryByText(/has been received/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Continue to secure UBA payment' })
  ).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Check your orders' }));
  expect(router.replace).toHaveBeenCalledWith('/orders');
  expect(onClose).not.toHaveBeenCalled();
});

it('ignores a successful initialization response after pending dismissal', async () => {
  const onClose = await mountReview();
  const deferred = Promise.withResolvers<Response>();
  mockFetch.mockImplementationOnce(() => deferred.promise);
  fireEvent.press(
    screen.getByRole('button', { name: 'Continue to secure UBA payment' })
  );
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  fireEvent.press(screen.getByRole('button', { name: 'Check your orders' }));

  await act(async () => {
    deferred.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        authorization_url: 'https://checkout.paystack.com/test',
        reference: 'RV-test',
      }),
    } as Response);
  });

  expect(router.replace).toHaveBeenCalledWith('/orders');
  expect(router.push).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('permits retry after a definitive initialization failure without starting a payment', async () => {
  initializationStatus = 400;
  await mountReview();
  fireEvent.press(
    screen.getByRole('button', { name: 'Continue to secure UBA payment' })
  );

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not start your UBA payment/i
    )
  );
  const retry = screen.getByRole('button', {
    name: 'Try secure UBA payment again',
  });
  fireEvent.press(retry);

  await waitFor(() =>
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).endsWith('/initialize')
      )
    ).toHaveLength(2)
  );
  expect(router.push).not.toHaveBeenCalled();
});

it('rejects incomplete persisted totals before a payment can start', async () => {
  orderBody = {
    ...responseBody,
    redvault: { status: 'pending', quote: { discount_kobo: 500 } },
  };
  await expect(createOrder(request)).rejects.toMatchObject({
    code: 'RESPONSE_VALIDATION_ERROR',
  });
  expect(
    mockFetch.mock.calls.some(([url]) => String(url).endsWith('/initialize'))
  ).toBe(false);
});

it('starts with a fresh review after closing and reopening an order', async () => {
  const input = {
    orderResponse: await createOrder(request),
    customerEmail: request.customer_email,
    customerName: request.customer_name,
    customerPhone: request.customer_phone,
  };
  const onClose = jest.fn();
  const view = <RedvaultOrderReview input={input} onClose={onClose} />;
  const { rerender } = render(view);
  fireEvent.press(
    screen.getByRole('button', { name: 'Choose another payment method' })
  );
  rerender(<RedvaultOrderReview input={null} onClose={onClose} />);
  rerender(view);
  fireEvent.press(
    screen.getByRole('button', { name: 'Continue to secure UBA payment' })
  );
  await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
});

it('discards the summary on a method switch and uses ordinary order identity', async () => {
  const onClose = await mountReview();
  fireEvent.press(
    screen.getByRole('button', { name: 'Choose another payment method' })
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  orderBody = {
    order: {
      id: 'ordinary',
      order_number: 'ORD',
      total: 1098,
      payment_status: 'unpaid',
      shipping_status: 'pending',
    },
    wallet: null,
    amountDueToGateway: 1098,
  };
  await createOrder({ ...request, payment_method: 'paystack' });
  const ordinary = mockFetch.mock.calls.at(-1)?.[1];
  expect(ordinary?.headers).toMatchObject({ 'Idempotency-Key': 'cart-one' });
  expect(JSON.parse(String(ordinary?.body))).toMatchObject({
    payment_method: 'paystack',
    discount_amount: 0,
  });
});
