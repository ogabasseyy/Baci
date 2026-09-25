import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCommerce } from '@/lib/supabase/client';
import { useOrderTotals } from './use-order-totals';

vi.mock('@/lib/supabase/client', () => ({
  calculateCommerce: vi.fn(),
}));

describe('useOrderTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns null initially', () => {
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1200,
      taxAmount: 120,
    });

    const { result } = renderHook(() =>
      useOrderTotals({ cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 })
    );

    expect(result.current).toBeNull();
  });

  it('returns order totals after successful calculateCommerce call', async () => {
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1200,
      taxAmount: 120,
    });

    const { result } = renderHook(() =>
      useOrderTotals({ cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 })
    );

    await waitFor(() => {
      expect(result.current).toEqual({ total: 1200, taxAmount: 120 });
    });

    expect(calculateCommerce).toHaveBeenCalledWith('calculate_order', {
      subtotal: 1000,
      shippingFee: 80,
      taxRate: 0.12,
    });
  });

  it('returns null and logs error when calculateCommerce throws', async () => {
    const error = new Error('RPC failed');
    vi.mocked(calculateCommerce).mockRejectedValue(error);

    const { result } = renderHook(() =>
      useOrderTotals({ cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 })
    );

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        'Failed to fetch totals from brain',
        error
      );
    });

    expect(result.current).toBeNull();
  });

  it('re-fetches when cartTotal changes', async () => {
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1200,
      taxAmount: 120,
    });

    const { result, rerender } = renderHook(
      ({ cartTotal, deliveryCost, taxRate }) =>
        useOrderTotals({ cartTotal, deliveryCost, taxRate }),
      { initialProps: { cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 } }
    );

    await waitFor(() =>
      expect(result.current).toEqual({ total: 1200, taxAmount: 120 })
    );

    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 2400,
      taxAmount: 240,
    });
    rerender({ cartTotal: 2000, deliveryCost: 80, taxRate: 0.12 });
    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toEqual({ total: 2400, taxAmount: 240 });
    });

    expect(calculateCommerce).toHaveBeenCalledTimes(2);
    expect(calculateCommerce).toHaveBeenLastCalledWith('calculate_order', {
      subtotal: 2000,
      shippingFee: 80,
      taxRate: 0.12,
    });
  });

  it('re-fetches when deliveryCost changes', async () => {
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1200,
      taxAmount: 120,
    });

    const { result, rerender } = renderHook(
      ({ cartTotal, deliveryCost, taxRate }) =>
        useOrderTotals({ cartTotal, deliveryCost, taxRate }),
      { initialProps: { cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 } }
    );

    await waitFor(() =>
      expect(result.current).toEqual({ total: 1200, taxAmount: 120 })
    );

    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1320,
      taxAmount: 120,
    });
    rerender({ cartTotal: 1000, deliveryCost: 200, taxRate: 0.12 });
    expect(result.current).toBeNull();

    await waitFor(() => expect(calculateCommerce).toHaveBeenCalledTimes(2));
  });

  it('re-fetches when taxRate changes', async () => {
    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1200,
      taxAmount: 120,
    });

    const { result, rerender } = renderHook(
      ({ cartTotal, deliveryCost, taxRate }) =>
        useOrderTotals({ cartTotal, deliveryCost, taxRate }),
      { initialProps: { cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 } }
    );

    await waitFor(() =>
      expect(result.current).toEqual({ total: 1200, taxAmount: 120 })
    );

    vi.mocked(calculateCommerce).mockResolvedValue({
      total: 1296,
      taxAmount: 216,
    });
    rerender({ cartTotal: 1000, deliveryCost: 80, taxRate: 0.2 });
    expect(result.current).toBeNull();

    await waitFor(() => expect(calculateCommerce).toHaveBeenCalledTimes(2));
  });

  it('keeps the current cart tax when an older calculation finishes last', async () => {
    let resolveOld!: (value: { total: number; taxAmount: number }) => void;
    const old = new Promise((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(calculateCommerce)
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({ total: 2150, taxAmount: 150 });
    const { result, rerender } = renderHook(
      (cartTotal) =>
        useOrderTotals({ cartTotal, deliveryCost: 0, taxRate: 0.075 }),
      { initialProps: 1000 }
    );
    rerender(2000);
    await waitFor(() =>
      expect(result.current).toEqual({ total: 2150, taxAmount: 150 })
    );
    await act(async () => resolveOld({ total: 1075, taxAmount: 75 }));
    expect(result.current).toEqual({ total: 2150, taxAmount: 150 });
  });

  it('ignores an obsolete failure after the current calculation succeeds', async () => {
    let rejectOld!: (reason: Error) => void;
    const old = new Promise((_, reject) => {
      rejectOld = reject;
    });
    vi.mocked(calculateCommerce)
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({ total: 2150, taxAmount: 150 });
    const { result, rerender } = renderHook(
      (cartTotal) =>
        useOrderTotals({ cartTotal, deliveryCost: 0, taxRate: 0.075 }),
      { initialProps: 1000 }
    );
    rerender(2000);
    await waitFor(() =>
      expect(result.current).toEqual({ total: 2150, taxAmount: 150 })
    );
    await act(async () => rejectOld(new Error('Old calculation timed out')));
    expect(console.error).not.toHaveBeenCalled();
    expect(result.current).toEqual({ total: 2150, taxAmount: 150 });
  });

  it('does not expose prior tax if the current cart calculation fails', async () => {
    vi.mocked(calculateCommerce)
      .mockResolvedValueOnce({ total: 1075, taxAmount: 75 })
      .mockRejectedValueOnce(new Error('Calculation unavailable'));
    const { result, rerender } = renderHook(
      (cartTotal) =>
        useOrderTotals({ cartTotal, deliveryCost: 0, taxRate: 0.075 }),
      { initialProps: 1000 }
    );
    await waitFor(() => expect(result.current?.taxAmount).toBe(75));
    rerender(2000);
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
