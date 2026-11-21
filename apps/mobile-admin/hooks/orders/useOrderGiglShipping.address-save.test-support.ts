import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { vi } from 'vitest';
import type { OrderGiglReceiver } from '@/lib/order-gigl-shipping';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';

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
      await server.patch({ shipping_address: shippingAddress });
      server.storedAddress = shippingAddress;
    },
  };
});

import { useOrderGiglShipping } from './useOrderGiglShipping';

export const trim = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export function differsFromStored(receiver: OrderGiglReceiver) {
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

export async function flushPromises() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

interface TestOrder {
  source?: string;
  customer_name: string;
  customer_phone: string | null;
  shipping_address: StoredAddress;
}

export function renderBoundQuote(order: TestOrder) {
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

export async function saveTypedCityAndState() {
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
  await act(() => view.result.current.saveAddressAndRequestQuote());
  return { ...view, order };
}

export { server };
