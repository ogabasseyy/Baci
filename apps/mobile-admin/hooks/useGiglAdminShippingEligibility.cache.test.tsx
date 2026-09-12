import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useGiglAdminShippingEligibility } from './useGiglAdminShippingEligibility';

const { from } = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from },
}));

function createShippingSettingsQuery() {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        merchant_id: 'merchant-1',
        shipping_providers: ['gigl'],
        free_shipping_threshold: null,
      },
      error: null,
    }),
  };
  query.eq.mockReturnValue(query);

  return { select: vi.fn(() => query) };
}

describe('bugfix: GIGL eligibility and shipping screen cache isolation', () => {
  it('loads eligibility settings when the shipping screen envelope is already cached', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['shipping-settings', 'merchant-1'], {
      currency: 'NGN',
      settings: {
        merchant_id: 'merchant-1',
        shipping_providers: [],
        free_shipping_threshold: null,
      },
    });
    from.mockReturnValue(createShippingSettingsQuery());

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(
      () =>
        useGiglAdminShippingEligibility({
          id: 'merchant-1',
          country: 'NG',
          payout_currency: 'NGN',
        }),
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.isEligible).toBe(true));
  });
});
