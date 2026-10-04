import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useReceiptList } from './use-receipt-list';

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(),
}));

function mockContexts({
  isAuthenticated = true,
  slug = 'ogabassey',
}: {
  isAuthenticated?: boolean;
  slug?: string;
} = {}) {
  vi.mocked(useCustomerAuth).mockReturnValue({
    customer: {
      id: 'customer-1',
      email: 'customer@example.com',
      first_name: 'Bassey',
      last_name: 'John',
    },
    isAuthenticated,
    isLoading: false,
  } as ReturnType<typeof useCustomerAuth>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: { slug, business_name: 'Ogabassey' },
  } as ReturnType<typeof useMerchantSafe>);
}

function mockOrdersResponse(orders: Array<Record<string, unknown>>) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ orders }),
  } as Response);
}

const order = {
  id: 'order-1',
  order_number: 'ORD-001',
  created_at: '2026-04-03T10:00:00.000Z',
  total: 100,
  amount_paid: 0,
  currency: 'NGN',
  payment_status: 'unpaid',
  payment_method: 'invoice',
  current_document_kind: 'invoice',
  invoice_type_code: '325',
  items: [{ id: 'item-1', name: 'Samsung Galaxy S26', quantity: 1, price: 100 }],
};

describe('useReceiptList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockContexts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads receipts and derives merchant data', async () => {
    mockOrdersResponse([order]);

    const { result } = renderHook(() => useReceiptList());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.filteredReceipts).toHaveLength(1);
    expect(result.current.merchantReceiptData).toMatchObject({
      business_name: 'Ogabassey',
    });
    expect(result.current.shouldShowOgabasseyAppBanner).toBe(true);
  });

  it('skips fetching for guests', async () => {
    mockContexts({ isAuthenticated: false });

    const { result } = renderHook(() => useReceiptList());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.filteredReceipts).toHaveLength(0);
  });

  it('filters by search query and selects orders with their kind', async () => {
    mockOrdersResponse([order]);

    const { result } = renderHook(() => useReceiptList());

    await waitFor(() => {
      expect(result.current.filteredReceipts).toHaveLength(1);
    });

    act(() => {
      result.current.setSearchQuery('galaxy');
    });
    expect(result.current.filteredReceipts).toHaveLength(1);

    act(() => {
      result.current.setSearchQuery('no-match');
    });
    expect(result.current.filteredReceipts).toHaveLength(0);

    act(() => {
      result.current.setSearchQuery('');
    });

    act(() => {
      result.current.handleViewReceipt(result.current.filteredReceipts[0]);
    });
    expect(result.current.selectedOrder?.order_number).toBe('ORD-001');
    expect(result.current.selectedDocumentKind).toBe('proforma');
    expect(result.current.isModalOpen).toBe(true);
  });
});
