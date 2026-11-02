import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eligible: true,
  externalWaybill: { reset: vi.fn() },
  onLinked: undefined as
    | undefined
    | ((result: { trackingNumber: string }) => void),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@/hooks/useGiglAdminShippingEligibility', () => ({
  useGiglAdminShippingEligibility: () => ({ isEligible: mocks.eligible }),
}));
vi.mock('@/hooks/orders/useOrderGiglExternalWaybill', () => ({
  useOrderGiglExternalWaybill: ({
    onLinked,
  }: {
    onLinked: (result: { trackingNumber: string }) => void;
  }) => {
    mocks.onLinked = onLinked;
    return mocks.externalWaybill;
  },
}));

import { useOrderDetailsGiglExternalWaybill } from './useOrderDetailsGiglExternalWaybill';

function render() {
  const closeShipmentFlow = vi.fn();
  const setSuccessModal = vi.fn();
  const hook = renderHook(() =>
    useOrderDetailsGiglExternalWaybill({
      closeShipmentFlow,
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      setSuccessModal,
    })
  );
  return { closeShipmentFlow, hook, setSuccessModal };
}

describe('useOrderDetailsGiglExternalWaybill', () => {
  beforeEach(() => {
    mocks.eligible = true;
  });

  it('offers the option only when the store can use GIG', () => {
    expect(render().hook.result.current).toBe(mocks.externalWaybill);
    mocks.eligible = false;
    expect(render().hook.result.current).toBeUndefined();
  });

  it('closes Ship Order and confirms once the waybill is attached', () => {
    const { closeShipmentFlow, setSuccessModal } = render();
    mocks.onLinked?.({ trackingNumber: '1349639588' });

    expect(closeShipmentFlow).toHaveBeenCalledTimes(1);
    expect(setSuccessModal).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'GIG waybill 1349639588 is now tracked on order ORD-1.',
        title: 'Waybill attached',
        visible: true,
      })
    );
  });
});
