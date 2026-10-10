import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import { useCart } from './use-cart';

const mockNetInfoFetch = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  fetch: () => mockNetInfoFetch(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

describe('useCart stock validation', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('blocks add-to-cart when split voucher lines already consume available stock', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        manage_stock: true,
        stock_quantity: 2,
        merchant_id: 'merchant-1',
      },
    });
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [{ id: 'variant-128', stock_quantity: 2, effective_policy: 'off' }],
      error: null,
    });
    const eq = jest.fn(() => ({ single }));
    const select = jest.fn(() => ({ eq }));
    const productQuery = { select } as unknown as ReturnType<
      typeof supabase.from
    >;
    jest.mocked(supabase.from).mockReturnValue(productQuery);

    const firstVoucher = {
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    };
    useCartStore.getState().addItem(firstVoucher);
    useCartStore.getState().addItem({
      ...firstVoucher,
      voucher_award_id: 'voucher-award-2',
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: Number.POSITIVE_INFINITY, retry: false },
        queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useCart(), { wrapper });

    try {
      act(() => {
        result.current.addToCart({
          product_id: 'product-1',
          slug: 'redmi-note-14',
          variant_id: 'variant-128',
          name: 'Redmi Note 14',
          price: 220000,
          quantity: 1,
        });
      });

      await waitFor(() => {
        expect(single).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(useCartStore.getState().items).toHaveLength(2);
      });
      await waitFor(() => {
        expect(result.current.isAddingToCart).toBe(false);
      });
      expect(useCartStore.getState().items).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ price: 220000 })])
      );
    } finally {
      unmount();
      queryClient.clear();
    }
  });

  it('validates an offer add against the offer projection', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        manage_stock: true,
        stock_quantity: 0,
        merchant_id: 'merchant-1',
      },
    });
    const eq = jest.fn(() => ({ single }));
    const select = jest.fn(() => ({ eq }));
    const productQuery = { select } as unknown as ReturnType<
      typeof supabase.from
    >;
    jest.mocked(supabase.from).mockReturnValue(productQuery);
    (supabase.rpc as jest.Mock).mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'get_storefront_product_base_inventory'
          ? {
              data: [{ product_id: 'product-1', effective_policy: 'legacy' }],
              error: null,
            }
          : {
              data: [{ offer_id: 'offer-7', stock_quantity: 2 }],
              error: null,
            }
      )
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: Number.POSITIVE_INFINITY, retry: false },
        queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useCart(), { wrapper });

    try {
      act(() => {
        result.current.addToCart({
          product_id: 'product-1',
          slug: 'redmi-note-14',
          offer_id: 'offer-7',
          name: 'Redmi Note 14',
          price: 180000,
          quantity: 1,
        });
      });

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', {
          p_product_id: 'product-1',
        });
      });
      await waitFor(() => {
        expect(result.current.isAddingToCart).toBe(false);
      });
      expect(useCartStore.getState().items).toEqual([
        expect.objectContaining({ offer_id: 'offer-7', price: 180000 }),
      ]);
    } finally {
      unmount();
      queryClient.clear();
    }
  });
});
