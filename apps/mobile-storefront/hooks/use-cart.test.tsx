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

const actualCartStock = jest.requireActual(
  './cart-stock'
) as typeof import('./cart-stock');
const mockCheckStock = jest.fn();
jest.mock('./cart-stock', () => {
  const actual = jest.requireActual('./cart-stock');
  return {
    ...actual,
    checkStock: (...args: unknown[]) => mockCheckStock(...args),
  };
});
// Default through to the real stock check so existing tests keep
// exercising it; ordering tests below override per-call.
mockCheckStock.mockImplementation((...args: unknown[]) =>
  (actualCartStock.checkStock as (...callArgs: unknown[]) => Promise<unknown>)(
    ...args
  )
);

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
    (supabase.rpc as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            product_id: 'product-1',
            offer_id: 'offer-7',
            allocatable_stock: 2,
            effective_policy: 'legacy',
            parent_eligible: true,
          },
        ],
        error: null,
      })
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
        expect(supabase.rpc).toHaveBeenCalledWith(
          'get_storefront_offer_resolution',
          {
            p_merchant_id: null,
            p_product_ids: ['product-1'],
          }
        );
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

  it('ignores a stale quantity failure after a newer edit succeeds', async () => {
    useCartStore.getState().addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
    });
    const lineId = useCartStore.getState().items[0].id;

    type StockResult = { available: boolean; currentStock: number };
    let releaseFirst!: (result: StockResult) => void;
    const firstGate = new Promise<StockResult>((resolve) => {
      releaseFirst = resolve;
    });
    mockCheckStock
      .mockImplementationOnce(() => firstGate)
      .mockImplementationOnce(async () => ({
        available: true,
        currentStock: 9,
      }));

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
        result.current.updateQuantity(lineId, 5);
      });
      act(() => {
        result.current.updateQuantity(lineId, 2);
      });
      await waitFor(() => {
        expect(mockCheckStock).toHaveBeenCalledTimes(2);
      });
      // The newer edit settles first; only then does the older check fail.
      await waitFor(() => {
        expect(result.current.isUpdatingQuantity).toBe(false);
      });
      await act(async () => {
        releaseFirst({ available: false, currentStock: 1 });
      });

      expect(useCartStore.getState().items[0].quantity).toBe(2);
    } finally {
      unmount();
      queryClient.clear();
    }
  });

  it('restores the previous quantity when the only edit fails', async () => {
    useCartStore.getState().addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
    });
    const lineId = useCartStore.getState().items[0].id;
    mockCheckStock.mockImplementationOnce(async () => ({
      available: false,
      currentStock: 1,
    }));

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
        result.current.updateQuantity(lineId, 5);
      });

      await waitFor(() => {
        expect(useCartStore.getState().items[0].quantity).toBe(1);
      });
    } finally {
      unmount();
      queryClient.clear();
    }
  });
});
