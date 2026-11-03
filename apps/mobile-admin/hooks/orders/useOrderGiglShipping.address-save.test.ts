import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderGiglReceiver } from '@/lib/order-gigl-shipping';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

type StoredAddress = Record<string, unknown>;

// A fake admin GIG quote endpoint that applies the bind_admin_gigl_quote
// stale_order_quote_inputs guard: a receiver override that differs from the
// order's stored shipping address is refused with 409.
const server = vi.hoisted(() => ({
  getQuote: vi.fn(),
  patch: vi.fn(),
  storedAddress: {} as StoredAddress,
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock('@/lib/order-gigl-shipping', () => {
  class TestShippingError extends Error {
    code?: string;
    status: number;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    getMerchantWalletSummary: vi.fn(),
    getOrRequestMerchantWalletFundingAccount: vi.fn(),
    getOrderGiglQuote: server.getQuote,
    OrderGiglShippingError: TestShippingError,
    saveOrderGiglShippingAddress: async (
      _orderId: string,
      shippingAddress: StoredAddress
    ) => {
      server.patch({ shipping_address: shippingAddress });
      server.storedAddress = shippingAddress;
    },
  };
});

import { useOrderGiglShipping } from './useOrderGiglShipping';

const trim = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

function differsFromStored(receiver: OrderGiglReceiver) {
  return (['address', 'city', 'state', 'phone'] as const).some(
    (field) =>
      receiver[field] !== undefined &&
      trim(receiver[field]) !== trim(server.storedAddress[field])
  );
}

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children
  );
}

async function flushPromises() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

interface TestOrder {
  customer_name: string;
  customer_phone: string | null;
  shipping_address: StoredAddress;
}

function renderBoundQuote(order: TestOrder) {
  server.storedAddress = order.shipping_address;
  return renderHook(
    ({ current }: { current: TestOrder }) =>
      useOrderGiglShipping({
        enabled: true,
        initialAddress: getOrderGiglInitialAddress(current),
        orderId: 'order-1',
        storedOrder: current,
      }),
    { initialProps: { current: order }, wrapper }
  );
}

async function saveTypedCityAndState() {
  const order = {
    customer_name: 'Ada',
    customer_phone: '0801',
    shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
  };
  const view = renderBoundQuote(order);
  await flushPromises();
  act(() => {
    view.result.current.updateAddressField('city', 'Ikeja ');
    view.result.current.updateAddressField('state', 'Lagos');
  });
  await act(() => view.result.current.requestQuote());
  return { ...view, order };
}

describe('bugfix: GIG bind refused typed address details as stale inputs', () => {
  beforeEach(() => {
    server.getQuote.mockReset();
    server.patch.mockReset();
    server.getQuote.mockImplementation(
      async (_orderId: string, receiver?: OrderGiglReceiver) => {
        if (receiver && differsFromStored(receiver)) {
          throw Object.assign(
            new Error('Order address or items changed since this quote.'),
            { code: 'stale_order_quote_inputs', status: 409 }
          );
        }
        const stored = server.storedAddress;
        if (!trim(stored.city) || !trim(stored.state)) {
          throw Object.assign(new Error('Incomplete'), {
            code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
            missing: [
              ...(trim(stored.city) ? [] : ['city']),
              ...(trim(stored.state) ? [] : ['state']),
            ],
          });
        }
        return quoteResult;
      }
    );
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
  });

  it('saves typed city and state to the order before binding instead of failing with 409', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
    });
    await flushPromises();
    expect(result.current.missingFields).toEqual(['city', 'state']);

    act(() => {
      result.current.updateAddressField('city', 'Ikeja');
      result.current.updateAddressField('state', 'Lagos');
    });
    await act(() => result.current.requestQuote());

    expect(server.patch).toHaveBeenCalledWith({
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '0801',
        state: 'Lagos',
      },
    });
    expect(server.getQuote).toHaveBeenLastCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
  });

  it('saves the customer phone when the stored delivery phone is blank instead of failing with 409', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '',
        state: 'Lagos',
      },
    });
    await flushPromises();

    expect(server.patch).toHaveBeenCalledWith({
      shipping_address: expect.objectContaining({ phone: '0801' }),
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('ready');
  });

  it('binds without saving or sending an override when the stored address is already complete', async () => {
    const { result } = renderBoundQuote({
      customer_name: 'Ada',
      customer_phone: '0801',
      shipping_address: {
        address: '1 Allen',
        city: 'Ikeja',
        name: 'Ada',
        phone: '0801',
        state: 'Lagos',
      },
    });
    await flushPromises();

    expect(server.patch).not.toHaveBeenCalled();
    expect(server.getQuote).toHaveBeenCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(result.current.state).toBe('ready');
  });
});

describe('bugfix: the order refetch after an address save asked for the bound quote again', () => {
  beforeEach(() => {
    server.getQuote.mockReset();
    server.patch.mockReset();
    server.getQuote.mockImplementation(async () => {
      const stored = server.storedAddress;
      if (!trim(stored.city) || !trim(stored.state)) {
        throw Object.assign(new Error('Incomplete'), {
          code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
          missing: ['city', 'state'],
        });
      }
      return quoteResult;
    });
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
  });

  it('keeps the bound quote when the refreshed order carries the saved address', async () => {
    const { order, rerender, result } = await saveTypedCityAndState();
    expect(server.patch).toHaveBeenCalledOnce();
    const requestsAfterBind = server.getQuote.mock.calls.length;

    rerender({
      current: { ...order, shipping_address: server.storedAddress },
    });
    await flushPromises();

    // Every /api/orders request shares one small per-IP rate limit.
    expect(server.getQuote).toHaveBeenCalledTimes(requestsAfterBind);
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
  });

  it('asks again when the refreshed order carries a different address', async () => {
    const { order, rerender, result } = await saveTypedCityAndState();
    const requestsAfterBind = server.getQuote.mock.calls.length;
    server.storedAddress = { ...server.storedAddress, state: 'Ogun' };

    rerender({
      current: { ...order, shipping_address: server.storedAddress },
    });
    await flushPromises();

    expect(server.getQuote).toHaveBeenCalledTimes(requestsAfterBind + 1);
    expect(server.getQuote).toHaveBeenLastCalledWith(
      'order-1',
      undefined,
      expect.any(AbortSignal)
    );
    expect(server.patch).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
  });
});
