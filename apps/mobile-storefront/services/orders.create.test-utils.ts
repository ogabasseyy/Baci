import type { CreateOrderRequest } from './orders';

export type MockAuthUserResponse = {
  data: { user: { id: string } | null };
  error: null;
};

export type MockAuthSessionResponse = {
  data: { session: { access_token: string } | null };
  error?: null;
};

export type MockCreateOrderApiResponse = {
  order: {
    id: string;
    order_number: string;
    total: number;
    payment_status: string;
    shipping_status: string;
    tracking_token: string | null;
    created_at?: string;
  };
  wallet: null;
  amountDueToGateway: number;
};

export type MockFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
};

export type MockFetchOptions = {
  body: string;
  headers?: Record<string, string>;
};

export interface RetryOptions {
  maxRetries?: number;
  timeout?: number;
}

export type CreateOrderResult = {
  order: {
    created_at: string;
  };
};

export type TestOrderItem = CreateOrderRequest['items'][number];

export function createFetchInspectors(mockFetchWithRetry: {
  mock: { calls: unknown[] };
}) {
  function getLastFetchCall(): [string, MockFetchOptions] {
    const fetchCall = mockFetchWithRetry.mock.calls.at(-1) as
      | [string, MockFetchOptions]
      | undefined;

    if (!fetchCall) {
      throw new Error(
        'Expected fetchWithRetry to be called before reading the request body'
      );
    }

    if (!fetchCall[1]?.body) {
      throw new Error(
        `Expected fetchWithRetry to be called with a JSON body, received: ${JSON.stringify(fetchCall)}`
      );
    }

    return fetchCall;
  }

  function getLastFetchBody() {
    const [, options] = getLastFetchCall();
    return JSON.parse(options.body);
  }

  function getLastFetchOptions(): MockFetchOptions {
    const [, options] = getLastFetchCall();
    return options;
  }

  return { getLastFetchBody, getLastFetchOptions };
}

export async function createOrderWithItems(items: TestOrderItem[]) {
  const { createOrder } = require('./orders') as typeof import('./orders');

  await createOrder({
    customer_email: 'test@example.com',
    customer_name: 'Test User',
    customer_phone: '+2348012345678',
    items,
    subtotal: items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    ),
    shipping_fee: 2000,
    payment_method: 'card',
    source: 'mobile',
    shipping_address: {
      firstName: 'Test',
      lastName: 'User',
      address: '123 St',
      city: 'Lagos',
      state: 'Lagos',
    },
  });
}
