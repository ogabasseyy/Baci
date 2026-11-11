// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const merchantState = vi.hoisted(() => ({
  current: null as null | {
    id?: string;
    payout_currency?: string | null;
    vat_rate?: number | null;
    vat_registration_status?: string | null;
  },
}));

const branchState = vi.hoisted(() => ({
  branches: [
    { id: 'branch-1', name: 'Lagos main', is_default: true },
    { id: 'branch-2', name: 'Abuja branch', is_default: false },
  ],
  scope: { type: 'branch', branchId: 'branch-2' } as
    | { type: 'all' }
    | { type: 'branch'; branchId: string },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: merchantState.current }),
}));

vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({ data: branchState.branches }),
}));

vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: branchState.scope }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, shadows: {} }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}));

vi.mock('@/hooks/useCustomers', () => ({
  useCreateCustomer: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./useNewOrderLookupData', () => ({
  useNewOrderLookupData: () => ({
    customersData: [],
    customersQuery: {},
    productPicker: {
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      products: [],
      refetch: vi.fn(),
    },
    selectedParentProductVariantsQuery: {
      data: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    },
  }),
}));

vi.mock('./useNewOrderUiState', () => ({
  useNewOrderUiState: () => ({
    customItem: { name: '', price: '' },
    setCustomItem: vi.fn(),
    setShowCustomItemModal: vi.fn(),
    setShowProductModal: vi.fn(),
    showCustomItemModal: false,
    showProductModal: false,
  }),
}));

vi.mock('./submitNewOrder', () => ({
  submitNewOrder: vi.fn(),
}));

vi.mock('./useQuickAddProductMatches', () => ({
  useQuickAddProductMatches: () => ({ isLoading: false, matches: [] }),
}));

vi.mock('./createNewOrderCustomerActions', () => ({
  createNewOrderCustomerActions: () => ({
    handleCloseCustomerModal: vi.fn(),
    handleCreateCustomer: vi.fn(),
    handleSelectCustomer: vi.fn(),
    resetNewCustomerForm: vi.fn(),
  }),
}));

vi.mock('./createNewOrderProductActions', () => ({
  createNewOrderProductActions: () => ({
    closeProductModal: vi.fn(),
    handleAddCustomItem: vi.fn(),
    handleAddProduct: vi.fn(),
    handleQuantityChange: vi.fn(),
    handleSelectProduct: vi.fn(),
    resetProductPickerState: vi.fn(),
  }),
}));

vi.mock('@/lib/new-order-totals', () => ({
  createNewOrderTotals: () => ({
    calculatedVat: 0,
    formatPrice: (n: number) => `₦${n}`,
    subtotal: 0,
    taxesToUse: 0,
    total: 0,
    vatRate: 0,
  }),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-0000-0000-000000000001',
}));

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() },
}));

vi.mock('react-native-country-picker-modal', () => ({}));

import { submitNewOrder } from './submitNewOrder';
import { useNewOrderController } from './useNewOrderController';

describe('useNewOrderController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantState.current = null;
    branchState.branches = [
      { id: 'branch-1', name: 'Lagos main', is_default: true },
      { id: 'branch-2', name: 'Abuja branch', is_default: false },
    ];
    branchState.scope = { type: 'branch', branchId: 'branch-2' };
  });

  it('returns initial default state', () => {
    merchantState.current = null;
    const { result } = renderHook(() => useNewOrderController());

    expect(result.current.selectedChannel).toBe('physical');
    expect(result.current.orderItems).toEqual([]);
    expect(result.current.paymentStatus).toBe('unpaid');
  });

  it('defaults the manual order branch to the concrete branch scope', () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'NGN' };

    const { result } = renderHook(() => useNewOrderController());

    expect(result.current.selectedBranchId).toBe('branch-2');
  });

  it('defaults all-location manual orders to the merchant default branch', () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'NGN' };
    branchState.scope = { type: 'all' };

    const { result } = renderHook(() => useNewOrderController());

    expect(result.current.selectedBranchId).toBe('branch-1');
  });

  it('passes the selected branch id into manual order submission', async () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'NGN' };
    const { result } = renderHook(() => useNewOrderController());

    await result.current.handleSubmit();

    expect(submitNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({ selectedBranchId: 'branch-2' })
    );
  });

  it('passes the selected order date into manual order submission', async () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'NGN' };
    const selectedDate = new Date('2024-02-03T10:30:00.000Z');
    const { result } = renderHook(() => useNewOrderController());

    await act(async () => {
      result.current.setDate(selectedDate);
    });
    await result.current.handleSubmit();

    expect(submitNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderDate: selectedDate })
    );
  });

  it('enables VAT when merchant has vat_registration_status registered', async () => {
    merchantState.current = {
      id: 'merchant-1',
      payout_currency: 'NGN',
      vat_rate: 7.5,
      vat_registration_status: 'registered',
    };
    const { result } = renderHook(() => useNewOrderController());

    await waitFor(() => {
      expect(result.current.isVatApplied).toBe(true);
    });
  });
});
