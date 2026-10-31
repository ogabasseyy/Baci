import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

const api = vi.hoisted(() => ({ getQuote: vi.fn(), saveAddress: vi.fn() }));

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock('@/lib/order-gigl-shipping', () => ({
  getMerchantWalletSummary: vi.fn(),
  getOrRequestMerchantWalletFundingAccount: vi.fn(),
  getOrderGiglQuote: api.getQuote,
  OrderGiglShippingError: class extends Error {},
  saveOrderGiglShippingAddress: api.saveAddress,
}));

import { useOrderGiglPreviewPrefetch } from './useOrderGiglPreviewPrefetch';
import { useOrderGiglShipping } from './useOrderGiglShipping';

type TestOrder = {
  customer_name: string;
  customer_phone: string | null;
  id: string;
  items: { id: string; name: string; price: number; quantity: number }[];
  selected_quote_id: string | null;
  shipping_address: Record<string, unknown>;
  shipping_funding_source: string | null;
  shipping_status: string;
};

const completeOrder: TestOrder = {
  customer_name: 'Ada',
  customer_phone: '0801',
  id: 'order-1',
  items: [{ id: 'item-1', name: 'Phone', price: 50000, quantity: 1 }],
  selected_quote_id: null,
  shipping_address: {
    address: '1 Allen Avenue',
    city: 'Ikeja',
    name: 'Ada',
    phone: '0801',
    state: 'Lagos',
  },
  shipping_funding_source: null,
  shipping_status: 'processing',
};

function quoteExpiringIn(milliseconds: number) {
  return {
    ...quoteResult,
    quote: {
      ...quoteResult.quote,
      expiresAt: new Date(Date.now() + milliseconds).toISOString(),
    },
  };
}

function createWrapper() {
  const client = new QueryClient();
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

type HarnessProps = { enabled?: boolean; order: TestOrder; sheetOpen: boolean };

// The order details screen: background prefetch plus the Ship Order sheet's
// GIG panel, which turns on when the merchant reaches the Shipping step.
function renderOrderDetails(initialProps: HarnessProps) {
  const states: string[] = [];
  const view = renderHook(
    ({ enabled = true, order, sheetOpen }: HarnessProps) => {
      const previewCacheScope = useOrderGiglPreviewPrefetch({
        enabled,
        order,
        userId: 'owner-1',
      });
      const panel = useOrderGiglShipping({
        enabled: sheetOpen,
        initialAddress: getOrderGiglInitialAddress(order),
        orderId: order.id,
        preview: true,
        previewCacheScope,
        storedOrder: order,
      });
      states.push(panel.state);
      return panel;
    },
    { initialProps, wrapper: createWrapper() }
  );
  return { ...view, states };
}

describe('useOrderGiglPreviewPrefetch', () => {
  beforeEach(() => {
    api.getQuote.mockReset();
    api.saveAddress.mockReset();
    api.getQuote.mockResolvedValue(quoteExpiringIn(60 * 60 * 1000));
  });

  it('starts a side-effect-free GIG preview when an owner opens a processing order', async () => {
    renderOrderDetails({ order: completeOrder, sheetOpen: false });

    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());
    expect(api.getQuote).toHaveBeenCalledWith(
      'order-1',
      {
        address: '1 Allen Avenue',
        city: 'Ikeja',
        phone: '0801',
        state: 'Lagos',
      },
      undefined,
      true
    );
    expect(api.saveAddress).not.toHaveBeenCalled();
  });

  it('prefetches a pinned address that has no city or state', async () => {
    renderOrderDetails({
      order: {
        ...completeOrder,
        shipping_address: {
          address: '1 Allen Avenue',
          latitude: 6.6,
          longitude: 3.35,
          phone: '0801',
        },
      },
      sheetOpen: false,
    });

    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());
  });

  it.each([
    [
      'the delivery address is incomplete',
      {
        ...completeOrder,
        shipping_address: { address: '1 Allen Avenue', phone: '0801' },
      },
    ],
    [
      'there is no delivery phone at all',
      {
        ...completeOrder,
        customer_phone: null,
        shipping_address: { ...completeOrder.shipping_address, phone: '' },
      },
    ],
    [
      'the order is still pending',
      { ...completeOrder, shipping_status: 'pending' },
    ],
    [
      'the customer already paid for a saved checkout quote',
      {
        ...completeOrder,
        selected_quote_id: 'quote-1',
        shipping_funding_source: 'customer_checkout',
      },
    ],
  ])('makes no GIG request when %s', async (_case, order: TestOrder) => {
    renderOrderDetails({ order, sheetOpen: false });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getQuote).not.toHaveBeenCalled();
  });

  it('makes no GIG request when the wallet panel does not apply (staff)', async () => {
    renderOrderDetails({
      enabled: false,
      order: completeOrder,
      sheetOpen: false,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getQuote).not.toHaveBeenCalled();
  });

  it('prices each order, address and items combination only once', async () => {
    const { rerender } = renderOrderDetails({
      order: completeOrder,
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());

    rerender({ order: { ...completeOrder }, sheetOpen: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getQuote).toHaveBeenCalledOnce();

    rerender({
      order: {
        ...completeOrder,
        shipping_address: { ...completeOrder.shipping_address, city: 'Yaba' },
      },
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledTimes(2));
  });

  it('shows the cached price on the Shipping step at once, with no spinner and no second GIG call', async () => {
    const { rerender, result, states } = renderOrderDetails({
      order: completeOrder,
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
    });
    states.length = 0;

    rerender({ order: completeOrder, sheetOpen: true });

    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(11000);
    expect(states).not.toContain('loading');
    expect(api.getQuote).toHaveBeenCalledOnce();
  });

  it('joins a prefetch that is still in flight instead of asking GIG again', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined;
    api.getQuote.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      })
    );
    const { rerender, result } = renderOrderDetails({
      order: completeOrder,
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());

    rerender({ order: completeOrder, sheetOpen: true });
    await act(async () => {
      resolvePreview(quoteExpiringIn(60 * 60 * 1000));
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(api.getQuote).toHaveBeenCalledOnce();
  });

  it('keeps a failed prefetch silent, then retries and shows the error in the panel', async () => {
    api.getQuote.mockRejectedValue(new Error('GIGL quote unavailable'));
    const { rerender, result } = renderOrderDetails({
      order: completeOrder,
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('idle');

    rerender({ order: completeOrder, sheetOpen: true });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('GIGL quote unavailable');
    expect(api.getQuote).toHaveBeenCalledTimes(2);
  });

  it('asks GIG again when the cached preview is about to expire', async () => {
    api.getQuote.mockResolvedValueOnce(quoteExpiringIn(10_000));
    const { rerender, result } = renderOrderDetails({
      order: completeOrder,
      sheetOpen: false,
    });
    await waitFor(() => expect(api.getQuote).toHaveBeenCalledOnce());

    rerender({ order: completeOrder, sheetOpen: true });

    await waitFor(() => expect(api.getQuote).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.state).toBe('ready'));
  });
});
