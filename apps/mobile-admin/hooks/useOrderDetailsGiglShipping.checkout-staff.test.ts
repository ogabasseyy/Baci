import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessState = vi.hoisted(() => ({
  current: { canFulfill: true, canEdit: false },
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

import { useOrderDetailsGiglShipping } from './useOrderDetailsGiglShipping';

const checkoutPaidOrder = {
  id: 'order-1',
  selected_quote_id: 'quote-1',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'customer_checkout',
} as never;

function render(userId: string) {
  return renderHook(() =>
    useOrderDetailsGiglShipping({
      giglEligible: true,
      order: checkoutPaidOrder,
      pendingShipmentMode: 'provider',
      providerLabel: 'GIG Logistics',
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
      userId,
    })
  );
}

describe('useOrderDetailsGiglShipping checkout-paid GIG for staff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shippingHook.mockReturnValue({ quote: null });
  });

  it.each([
    ['fulfill-only', { canFulfill: true, canEdit: false }],
    ['no-fulfill', { canFulfill: false, canEdit: false }],
  ])('keeps %s staff off the wallet flow and denies booking', (_name, access) => {
    accessState.current = access;
    const { result } = render('staff-1');

    expect(result.current.giglShipping).toBeUndefined();
    expect(result.current.providerBookingAvailable).toBe(false);
    expect(shippingHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(prefetchHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('still lets staff with fulfill and edit book the saved checkout quote', () => {
    accessState.current = { canFulfill: true, canEdit: true };
    const { result } = render('staff-2');

    expect(result.current.giglShipping).toBeUndefined();
    expect(result.current.providerBookingAvailable).toBe(true);
  });
});
