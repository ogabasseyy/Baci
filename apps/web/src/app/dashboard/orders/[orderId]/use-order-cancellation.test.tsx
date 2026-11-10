import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiPost: mocks.apiPost }));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ hasPermission: () => true }),
}));

import type { Order } from '../actions';
import { useOrderCancellation } from './use-order-cancellation';

const paystackLeg = {
  amount: 5000,
  gateway: 'paystack',
  gateway_reference: 'ref-1',
  id: 'leg-1',
  status: 'completed',
  transaction_type: 'payment',
};

const order = (over: Partial<Order> = {}) =>
  ({
    id: 'order-1',
    paymentStatus: 'Paid',
    total: 5000,
    transactions: [paystackLeg],
    ...over,
  }) as unknown as Order;

describe('useOrderCancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the choice dialog when there is money to refund', async () => {
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => result.current.requestCancellation());
    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.dialogProps.refundAmount).toBe(5000);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('uses the plain confirmation when nothing is refundable', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.apiPost.mockResolvedValue({ success: true });
    const onCancelled = vi.fn();
    const { result } = renderHook(() =>
      useOrderCancellation({
        onCancelled,
        order: order({ transactions: [] } as Partial<Order>),
      })
    );
    await act(() => result.current.requestCancellation());
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/api/orders/order-1/cancelled',
      { cancelled_by: 'merchant', confirm_cancellation: true }
    );
    expect(onCancelled).toHaveBeenCalled();
  });

  it('words the toast from the server outcome, not the requested choice', async () => {
    mocks.apiPost.mockResolvedValue({
      sideEffects: { refund: 'queued_if_required' },
      success: true,
    });
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => result.current.requestCancellation());
    await act(() => result.current.dialogProps.onConfirm('manual'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.not.objectContaining({ description: expect.anything() })
    );
  });

  it('reports a pending refund when the server says manual is required', async () => {
    mocks.apiPost.mockResolvedValue({
      sideEffects: { refund: 'manual_required' },
      success: true,
    });
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => result.current.requestCancellation());
    await act(() => result.current.dialogProps.onConfirm('manual'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Refund pending'),
      })
    );
    expect(result.current.dialogProps.isOpen).toBe(false);
  });

  it('keeps the dialog open when the request fails', async () => {
    mocks.apiPost.mockRejectedValue(new Error('nope'));
    const onCancelled = vi.fn();
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled, order: order() })
    );
    await act(() => result.current.requestCancellation());
    await act(() => result.current.dialogProps.onConfirm('automatic'));
    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(onCancelled).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });
});
