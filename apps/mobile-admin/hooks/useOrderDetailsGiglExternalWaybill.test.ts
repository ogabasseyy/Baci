// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eligible: true,
  externalWaybill: { reset: vi.fn() },
  beforeLink: undefined as undefined | (() => Promise<void>),
  onLinked: undefined as
    | undefined
    | ((result: { trackingNumber: string }) => void),
  update: vi.fn(),
  updateError: null as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        mocks.update(values);
        return {
          eq: () => ({
            eq: () => Promise.resolve({ error: mocks.updateError }),
          }),
        };
      },
    }),
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@/hooks/useGiglAdminShippingEligibility', () => ({
  useGiglAdminShippingEligibility: () => ({ isEligible: mocks.eligible }),
}));
vi.mock('@/hooks/orders/useOrderGiglExternalWaybill', () => ({
  useOrderGiglExternalWaybill: ({
    beforeLink,
    onLinked,
  }: {
    beforeLink: () => Promise<void>;
    onLinked: (result: { trackingNumber: string }) => void;
  }) => {
    mocks.beforeLink = beforeLink;
    mocks.onLinked = onLinked;
    return mocks.externalWaybill;
  },
}));

import { useOrderDetailsGiglExternalWaybill } from './useOrderDetailsGiglExternalWaybill';

const imeiDetails = {
  imei: '',
  items: [{ imei: '356789012345678', serialNumber: '' }],
  serialNumber: '',
} as never;

function render(
  fulfillmentDetails = { imei: '', items: [], serialNumber: '' } as never
) {
  const closeShipmentFlow = vi.fn();
  const setSuccessModal = vi.fn();
  const deferred: Array<() => void> = [];
  const runAfterShipmentFlowDismissed = (task: () => void) => {
    deferred.push(task);
  };
  const hook = renderHook(() =>
    useOrderDetailsGiglExternalWaybill({
      closeShipmentFlow,
      fulfillmentDetails,
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      runAfterShipmentFlowDismissed,
      setSuccessModal,
    })
  );
  return { closeShipmentFlow, deferred, hook, setSuccessModal };
}

describe('useOrderDetailsGiglExternalWaybill', () => {
  beforeEach(() => {
    mocks.eligible = true;
    mocks.update.mockReset();
    mocks.updateError = null;
  });

  it('saves entered device identifiers before attaching the waybill', async () => {
    render(imeiDetails);
    await mocks.beforeLink?.();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment_details: expect.anything() })
    );
  });

  it('skips the save when nothing was entered and stops on a failed save', async () => {
    render();
    await mocks.beforeLink?.();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.updateError = { message: 'denied' };
    render(imeiDetails);
    await expect(mocks.beforeLink?.()).rejects.toThrow(
      'Could not save the IMEI or serial numbers'
    );
  });

  it('offers the option only when the store can use GIG', () => {
    expect(render().hook.result.current).toBe(mocks.externalWaybill);
    mocks.eligible = false;
    expect(render().hook.result.current).toBeUndefined();
  });

  it('closes Ship Order and confirms once the waybill is attached', () => {
    const { closeShipmentFlow, deferred, setSuccessModal } = render();
    mocks.onLinked?.({ trackingNumber: '1349639588' });

    expect(closeShipmentFlow).toHaveBeenCalledTimes(1);
    // The dialog waits until the sheet has finished closing.
    expect(setSuccessModal).not.toHaveBeenCalled();
    for (const task of deferred) task();
    expect(setSuccessModal).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'GIG waybill 1349639588 is now tracked on order ORD-1.',
        title: 'Waybill attached',
        visible: true,
      })
    );
  });
});
