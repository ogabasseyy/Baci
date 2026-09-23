import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const shippingHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/orders/useOrderGiglShipping', () => ({
  useOrderGiglShipping: shippingHook,
}));
vi.mock('@/lib/order-shipment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/order-shipment')>();
  return {
    ...actual,
    getOrderGiglInitialAddress: vi.fn(() => ({ address: '1 Allen' })),
  };
});

import { useOrderDetailsGiglShipping } from './useOrderDetailsGiglShipping';

describe('useOrderDetailsGiglShipping', () => {
  it('only enables the owner wallet flow during the shipment method step', () => {
    shippingHook.mockReturnValue({ quote: null });
    const order = {
      id: 'order-1',
      selected_quote_id: null,
      shipping_provider: null,
      shipping_funding_source: null,
    } as never;

    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order,
        pendingShipmentMode: 'provider',
        providerLabel: null,
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(shippingHook).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, orderId: 'order-1' })
    );
    expect(result.current.isMerchantOwner).toBe(true);
  });

  it('hides the wallet flow from non-owner staff', () => {
    shippingHook.mockReturnValue({ quote: { id: 'q' } });
    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order: { id: 'order-1' } as never,
        pendingShipmentMode: 'provider',
        providerLabel: null,
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'staff-1',
      })
    );

    expect(result.current.isMerchantOwner).toBe(false);
    expect(result.current.giglShipping).toBeUndefined();
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, preview: false })
    );
  });

  it('requests a non-mutating preview while Self Fulfill remains selected', () => {
    shippingHook.mockReturnValue({ quote: null });
    const order = {
      id: 'order-1',
      selected_quote_id: null,
      shipping_provider: null,
      shipping_funding_source: null,
    } as never;

    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        orderId: 'order-1',
        preview: true,
      })
    );
    expect(result.current.giglShipping).toEqual({ quote: null });
  });

  it('keeps a precomputed quote available immediately while Self Fulfill is selected', () => {
    const precomputedQuote = { id: 'precomputed-quote' };
    shippingHook.mockReturnValue({ quote: precomputedQuote });

    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order: { id: 'order-1' } as never,
        pendingShipmentMode: 'self_fulfillment',
        providerLabel: null,
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(result.current.giglShipping?.quote).toBe(precomputedQuote);
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, preview: true })
    );
  });

  it('starts the quote request after provider fulfillment is selected', () => {
    shippingHook.mockReturnValue({ quote: null });
    const order = { id: 'order-1' } as never;
    type ShipmentModeProps = {
      pendingShipmentMode: 'provider' | 'self_fulfillment';
    };
    const { rerender } = renderHook(
      ({ pendingShipmentMode }: ShipmentModeProps) =>
        useOrderDetailsGiglShipping({
          giglEligible: true,
          merchant: { user_id: 'owner-1' } as never,
          order,
          pendingShipmentMode,
          providerLabel: null,
          shipmentFlowStep: 'method',
          showShipmentFlow: true,
          userId: 'owner-1',
        }),
      {
        initialProps: {
          pendingShipmentMode: 'self_fulfillment',
        } as ShipmentModeProps,
      }
    );

    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, preview: true })
    );
    rerender({ pendingShipmentMode: 'provider' });
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, preview: false })
    );
  });

  it('returns undefined when a saved non-wallet provider quote is bookable', () => {
    shippingHook.mockReturnValue({ quote: null, wallet: { canBook: false } });
    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order: {
          id: 'order-1',
          selected_quote_id: 'quote-topship',
          shipping_provider: 'TOPSHIP',
          shipping_funding_source: 'customer_checkout',
        } as never,
        pendingShipmentMode: 'provider',
        providerLabel: 'Topship',
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(result.current.providerBookingAvailable).toBe(true);
    expect(result.current.giglShipping).toBeUndefined();
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('keeps the wallet flow for a saved merchant-wallet GIGL quote', () => {
    shippingHook.mockReturnValue({
      quote: { id: 'q1' },
      wallet: { canBook: true },
    });
    const { result } = renderHook(() =>
      useOrderDetailsGiglShipping({
        giglEligible: true,
        merchant: { user_id: 'owner-1' } as never,
        order: {
          id: 'order-1',
          selected_quote_id: 'quote-gigl',
          shipping_provider: 'GIGL',
          shipping_funding_source: 'merchant_wallet',
        } as never,
        pendingShipmentMode: 'provider',
        providerLabel: 'GIG Logistics',
        shipmentFlowStep: 'method',
        showShipmentFlow: true,
        userId: 'owner-1',
      })
    );

    expect(result.current.providerBookingAvailable).toBe(true);
    expect(result.current.giglShipping).toEqual({
      quote: { id: 'q1' },
      wallet: { canBook: true },
    });
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, preview: false })
    );
  });
});
