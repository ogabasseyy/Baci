import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  evidence: vi.fn(),
  merchant: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiPost: mocks.apiPost }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mocks.evidence }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mocks.merchant(),
}));

import type { Order } from '../actions';
import { useOrderCancellation } from './use-order-cancellation';

const paystackLeg = {
  amount: 5000,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref-1',
  id: 'leg-1',
  status: 'completed',
  transaction_type: 'payment',
};

const order = (over: Partial<Order> = {}) =>
  ({
    id: 'order-1',
    amountPaid: 5000,
    paymentStatus: 'Paid',
    total: 5000,
    transactions: [paystackLeg],
    ...over,
  }) as unknown as Order;

describe('useOrderCancellation recorded amount paid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockReturnValue({ hasPermission: () => true });
    mocks.evidence.mockResolvedValue({ data: false, error: null });
  });

  it.each([
    ['the recorded amount paid is missing', { amountPaid: null }],
    [
      'captures exceed the recorded amount paid',
      {
        amountPaid: 5000,
        transactions: [
          paystackLeg,
          { ...paystackLeg, gateway_reference: 'ref-2', id: 'leg-2' },
        ],
      },
    ],
  ])('cancels neutrally when %s', async (_name, over) => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result: hook } = renderHook(() =>
      useOrderCancellation({
        onCancelled: vi.fn(),
        order: order(over as Partial<Order>),
      })
    );
    await act(() => hook.current.requestCancellation());
    expect(hook.current.dialogProps.isOpen).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("couldn't be loaded")
    );
  });
});

describe('useOrderCancellation malformed refund details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockReturnValue({ hasPermission: () => true });
    mocks.evidence.mockResolvedValue({ data: false, error: null });
  });

  it.each([
    [
      'a negative remaining amount',
      { currency: 'NGN', inFlightAmount: 0, remainingAmount: -3000 },
    ],
    [
      'a NaN in-flight amount',
      { currency: 'NGN', inFlightAmount: Number.NaN, remainingAmount: 100 },
    ],
    [
      'a blank currency',
      { currency: '', inFlightAmount: 100, remainingAmount: 100 },
    ],
    [
      'a string amount',
      { currency: 'NGN', inFlightAmount: '100', remainingAmount: 100 },
    ],
  ])('shows the neutral message, not a hand-refund amount, for %s', async (_name, refundDetails) => {
    mocks.apiPost.mockResolvedValue({
      sideEffects: { refund: 'manual_required', refundDetails },
      success: true,
    });
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => result.current.requestCancellation());
    await act(() => result.current.dialogProps.onConfirm('manual'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Check the order'),
      })
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/Refund pending|you only need/),
      })
    );
  });
});
