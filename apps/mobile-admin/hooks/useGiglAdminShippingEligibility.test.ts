import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryState = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isError: false,
    isLoading: false,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryState.current,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { useGiglAdminShippingEligibility } from './useGiglAdminShippingEligibility';

describe('useGiglAdminShippingEligibility', () => {
  beforeEach(() => {
    queryState.current = {
      data: {
        merchant_id: 'merchant-1',
        shipping_providers: ['gigl'],
        free_shipping_threshold: null,
      },
      isError: false,
      isLoading: false,
    };
  });

  it('allows GIGL only for an NG/NGN merchant with GIGL enabled', () => {
    const { result } = renderHook(() =>
      useGiglAdminShippingEligibility({
        id: 'merchant-1',
        country: 'NG',
        payout_currency: 'NGN',
      })
    );

    expect(result.current.isEligible).toBe(true);
  });

  it('fails closed while shipping settings are loading or errored', () => {
    queryState.current = {
      data: undefined,
      isError: false,
      isLoading: true,
    };

    const { result, rerender } = renderHook(() =>
      useGiglAdminShippingEligibility({
        id: 'merchant-1',
        country: 'NG',
        payout_currency: 'NGN',
      })
    );

    expect(result.current.isEligible).toBe(false);

    queryState.current = { data: undefined, isError: true, isLoading: false };
    rerender();
    expect(result.current.isEligible).toBe(false);
  });
});
