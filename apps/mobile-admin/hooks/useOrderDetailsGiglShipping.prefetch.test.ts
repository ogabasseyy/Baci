import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = { canFulfill: true, canEdit: true };
const accessState = vi.hoisted(() => ({
  current: { canFulfill: true, canEdit: true },
}));
const shippingHook = vi.hoisted(() => vi.fn());
const prefetchHook = vi.hoisted(() => vi.fn(() => 'preview-scope'));
vi.mock('@/hooks/useOrderFulfillAccess', () => ({
  useOrderFulfillAccess: () => accessState.current,
}));
vi.mock('@/hooks/orders/useOrderGiglShipping', () => ({
  useOrderGiglShipping: shippingHook,
}));
vi.mock('@/hooks/orders/useOrderGiglPreviewPrefetch', () => ({
  useOrderGiglPreviewPrefetch: prefetchHook,
}));
vi.mock('@/lib/order-shipment', async (importOriginal) => {
  const actual = await importOriginal<OrderShipmentModule>();
  return {
    ...actual,
    getOrderGiglInitialAddress: vi.fn(() => ({ address: '1 Allen' })),
  };
});

import { useOrderDetailsGiglShipping } from './useOrderDetailsGiglShipping';

type OrderShipmentModule = typeof import('@/lib/order-shipment');

describe('useOrderDetailsGiglShipping background price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessState.current = OWNER;
  });

  it('never prefetches a GIG preview for staff without orders.fulfill', () => {
    accessState.current = { canFulfill: false, canEdit: false };
    shippingHook.mockReturnValue({ quote: null });
    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        order: { id: 'order-1', shipping_status: 'processing' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'details',
        showShipmentFlow: false,
        showStatusModal: true,
        userId: 'staff-1',
      })
    );

    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, userId: 'staff-1' })
    );
  });

  it('prefetches for staff with orders.fulfill once they open the status sheet', () => {
    accessState.current = { canFulfill: true, canEdit: false };
    shippingHook.mockReturnValue({ quote: null });
    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        order: { id: 'order-1', shipping_status: 'processing' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'details',
        showShipmentFlow: false,
        showStatusModal: true,
        userId: 'staff-1',
      })
    );

    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, userId: 'staff-1' })
    );
  });

  it('does not prefetch while the owner is only viewing the order', () => {
    shippingHook.mockReturnValue({ quote: null });
    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        order: { id: 'order-1', shipping_status: 'processing' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'details',
        showShipmentFlow: false,
        showStatusModal: false,
        userId: 'owner-1',
      })
    );

    // Browsing orders must not spend the shared /api/orders rate limit.
    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('prefetches once the owner opens the status sheet and shares the cache with the panel', () => {
    shippingHook.mockReturnValue({ quote: null });
    const order = {
      customer_name: 'Ada',
      customer_phone: '0801',
      id: 'order-1',
      selected_quote_id: null,
      shipping_address: { address: '1 Allen' },
      shipping_status: 'processing',
    } as never;

    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        order,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'details',
        showShipmentFlow: false,
        showStatusModal: true,
        userId: 'owner-1',
      })
    );

    expect(prefetchHook).toHaveBeenLastCalledWith({
      enabled: true,
      order,
      userId: 'owner-1',
    });
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        previewCacheScope: 'preview-scope',
        storedOrder: order,
      })
    );
  });

  it('prefetches during the Ship Order details step, before the Shipping step', () => {
    shippingHook.mockReturnValue({ quote: null });
    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        order: { id: 'order-1', shipping_status: 'processing' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'details',
        showShipmentFlow: true,
        showStatusModal: false,
        userId: 'owner-1',
      })
    );

    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('does not prefetch when GIG is not eligible for the merchant', () => {
    shippingHook.mockReturnValue({ quote: null });
    renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: false,
        order: { id: 'order-1', shipping_status: 'processing' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });
});
