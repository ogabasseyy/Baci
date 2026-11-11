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

describe('useOrderCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockReturnValue({ hasPermission: () => true });
    mocks.evidence.mockResolvedValue({ data: false, error: null });
  });

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

  it('does not offer the automatic refund for a partially refunded leg', async () => {
    const { result } = renderHook(() =>
      useOrderCancellation({
        onCancelled: vi.fn(),
        order: order({
          transactions: [
            { ...paystackLeg, amount: 100 },
            {
              amount: 20,
              currency: 'NGN',
              gateway: 'paystack',
              payment_transaction_id: 'leg-1',
              provider_refund_status: 'processed',
              status: 'completed',
              transaction_type: 'refund',
            },
          ],
        } as Partial<Order>),
      })
    );
    await act(() => result.current.requestCancellation());
    expect(result.current.dialogProps.refundAmount).toBe(80);
    expect(result.current.dialogProps.automaticSupported).toBe(false);
  });

  it('offers only a plain confirmation when everything is already being refunded', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() =>
      useOrderCancellation({
        onCancelled: vi.fn(),
        order: order({
          transactions: [{ ...paystackLeg, status: 'refund_pending' }],
        } as Partial<Order>),
      })
    );
    await act(() => result.current.requestCancellation());
    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('already in progress with the provider')
    );
  });

  it('cancels neutrally without offering a manual refund when the ledger is unavailable', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.apiPost.mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useOrderCancellation({
        onCancelled: vi.fn(),
        order: order({ transactions: undefined } as Partial<Order>),
      })
    );
    await act(() => result.current.requestCancellation());
    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("couldn't be loaded")
    );
    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/api/orders/order-1/cancelled',
      { cancelled_by: 'merchant', confirm_cancellation: true }
    );
  });

  it('shows neutral copy when the server reports an unknown refund outcome', async () => {
    mocks.apiPost.mockResolvedValue({
      sideEffects: { refund: 'unknown' },
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
        description: expect.stringContaining('Refund pending'),
      })
    );
  });

  it('states what the provider is already refunding and what remains for the merchant', async () => {
    mocks.apiPost.mockResolvedValue({
      sideEffects: {
        refund: 'manual_required',
        refundDetails: {
          currency: 'NGN',
          inFlightAmount: 2000,
          remainingAmount: 3000,
        },
      },
      success: true,
    });
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => result.current.requestCancellation());
    await act(() => result.current.dialogProps.onConfirm('manual'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(
          /2,000\.00 is already being refunded by the provider; you only need to refund .*3,000\.00/
        ),
      })
    );
  });

  it('cancels neutrally when an unlinked in-flight refund cannot be attributed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() =>
      useOrderCancellation({
        onCancelled: vi.fn(),
        order: order({
          transactions: [
            paystackLeg,
            {
              amount: 5000,
              gateway: 'paystack',
              status: 'processing',
              transaction_type: 'refund',
            },
          ],
        } as Partial<Order>),
      })
    );
    await act(() => result.current.requestCancellation());
    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("couldn't be loaded")
    );
  });

  it('hides cancel-only until the refund permission resolves', () => {
    mocks.merchant.mockReturnValue(null);
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    expect(result.current.dialogProps.canCancelOnly).toBe(false);
  });

  it('offers cancel-only once the merchant context grants the refund permission', () => {
    const { result } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    expect(result.current.dialogProps.canCancelOnly).toBe(true);
  });

  it.each([
    ['an unresolved movement review is open', { data: true, error: null }],
    ['the evidence check fails', { data: null, error: { message: 'x' } }],
  ])('cancels neutrally without a manual option when %s', async (_name, result) => {
    mocks.evidence.mockResolvedValue(result);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result: hook } = renderHook(() =>
      useOrderCancellation({ onCancelled: vi.fn(), order: order() })
    );
    await act(() => hook.current.requestCancellation());
    expect(hook.current.dialogProps.isOpen).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("couldn't be loaded")
    );
    expect(mocks.evidence).toHaveBeenCalledWith(
      'order_has_unresolved_refund_evidence',
      { p_order_id: 'order-1' }
    );
  });
});
