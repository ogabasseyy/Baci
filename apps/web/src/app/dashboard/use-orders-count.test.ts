import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eqMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({ eq: eqMock })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

import { useOrdersCount } from './use-orders-count';

describe('useOrdersCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 without querying when the merchant id is undefined', () => {
    const { result } = renderHook(() => useOrdersCount(undefined));

    expect(result.current).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns the fetched orders count', async () => {
    eqMock.mockResolvedValue({ count: 7, error: null });

    const { result } = renderHook(() => useOrdersCount('merchant-1'));

    await waitFor(() => {
      expect(result.current).toBe(7);
    });
    expect(fromMock).toHaveBeenCalledWith('orders');
  });

  it('returns 0 when Supabase reports an error', async () => {
    eqMock.mockResolvedValue({ count: null, error: new Error('boom') });

    const { result } = renderHook(() => useOrdersCount('merchant-1'));

    await waitFor(() => {
      expect(fromMock).toHaveBeenCalled();
    });
    expect(result.current).toBe(0);
  });

  it('returns 0 when the query rejects', async () => {
    eqMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useOrdersCount('merchant-1'));

    await waitFor(() => {
      expect(fromMock).toHaveBeenCalled();
    });
    expect(result.current).toBe(0);
  });
});
