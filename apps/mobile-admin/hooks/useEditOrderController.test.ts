import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderItem } from '@/components/orders/new-order.types';

const alertMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const useNewOrderControllerMock = vi.hoisted(() => vi.fn());
const useOrderMock = vi.hoisted(() => vi.fn());
const useUpdateOrderMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  Alert: { alert: alertMock },
}));

vi.mock('expo-router', () => ({
  router: { replace: replaceMock },
  useLocalSearchParams: () => ({ id: 'order-1' }),
}));

vi.mock('./useNewOrderController', () => ({
  useNewOrderController: useNewOrderControllerMock,
}));

vi.mock('./useOrders', () => ({
  useOrder: useOrderMock,
}));

vi.mock('./orders/useUpdateOrder', () => ({
  useUpdateOrder: useUpdateOrderMock,
}));

import { useEditOrderController } from './useEditOrderController';

type BaseController = ReturnType<
  typeof import('./useNewOrderController').useNewOrderController
>;

const orderItems: OrderItem[] = [
  {
    id: 'line-1',
    is_custom: false,
    name: 'Phone',
    price: 1000,
    product_id: 'product-1',
    quantity: 2,
    variant_attributes: { color: 'Blue', storage: '512GB' },
    variant_id: 'variant-1',
    variant_name: 'Blue / 512GB',
  },
];

function createBaseController(
  overrides: Partial<BaseController> = {}
): BaseController {
  return {
    customer: {
      address: '1 Baci Road',
      email: 'ada@example.com',
      id: 'customer-1',
      name: 'Ada Buyer',
      phone: '08030000000',
    },
    deliveryInfo: {
      address: '',
      city: '',
      name: '',
      phone: '',
      state: '',
    },
    discount: 0,
    notes: '',
    orderItems,
    sameAsCustomer: true,
    selectedBranchId: 'branch-1',
    selectedChannel: 'physical',
    setDate: vi.fn(),
    setCustomer: vi.fn(),
    setDeliveryInfo: vi.fn(),
    setDiscount: vi.fn(),
    setIsVatApplied: vi.fn(),
    setNotes: vi.fn(),
    setOrderItems: vi.fn(),
    setSelectedBranchId: vi.fn(),
    setSelectedChannel: vi.fn(),
    setShippingFee: vi.fn(),
    setShowSuccessModal: vi.fn(),
    setTaxes: vi.fn(),
    setSameAsCustomer: vi.fn(),
    shippingFee: 0,
    taxesToUse: 0,
    total: 0,
    ...overrides,
  } as unknown as BaseController;
}

describe('useEditOrderController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrderMock.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('falls back to customer contact when shipping contact is missing', () => {
    const baseController = createBaseController();
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        customer_name: 'Buyer',
        customer_phone: '08039999999',
        id: 'order-1',
        shipping_address: { address: '12 Allen Avenue' },
      },
      isLoading: false,
    });

    renderHook(() => useEditOrderController());

    expect(baseController.setSameAsCustomer).toHaveBeenCalledWith(true);
    expect(baseController.setDeliveryInfo).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Buyer', phone: '08039999999' })
    );
  });

  it('preserves nullable branch and source values when prefilling edits', async () => {
    const baseController = createBaseController();
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        branch_id: null,
        customer_name: 'Legacy Buyer',
        customer_phone: '08039999999',
        id: 'order-1',
        shipping_address: { address: '12 Allen Avenue' },
        source: null,
        tax_amount: 0,
      },
      isLoading: false,
    });

    renderHook(() => useEditOrderController());

    await waitFor(() => {
      expect(baseController.setSelectedBranchId).toHaveBeenCalledWith(null);
    });
    expect(baseController.setSelectedChannel).toHaveBeenCalledWith(null);
    expect(baseController.setTaxes).toHaveBeenCalledWith(0);
    expect(baseController.setIsVatApplied).toHaveBeenCalledWith(false);
  });

  it('leaves VAT disabled for legacy orders without a classified tax basis', async () => {
    const baseController = createBaseController();
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        customer_name: 'Legacy Buyer',
        customer_phone: '08039999999',
        id: 'order-1',
        shipping_address: { address: '12 Allen Avenue' },
        tax_amount: 0,
        tax_basis: null,
      },
      isLoading: false,
    });

    renderHook(() => useEditOrderController());

    await waitFor(() => {
      expect(baseController.setIsVatApplied).toHaveBeenCalledWith(false);
    });
  });

  it('includes preserved gift wrapping in the edit total display', () => {
    const baseController = createBaseController({
      taxesToUse: 0,
      total: 1000,
    });
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        customer_name: 'Buyer',
        customer_phone: '08039999999',
        gift_wrapping_fee: 250,
        id: 'order-1',
        shipping_address: { address: '12 Allen Avenue' },
        tax_amount: 0,
        tax_basis: 'exclusive',
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useEditOrderController());

    return waitFor(() => {
      expect(result.current.total).toBe(1250);
    });
  });

  it('does not double-count inclusive tax in the edit total display', () => {
    const baseController = createBaseController({
      taxesToUse: 100,
      total: 1100,
    });
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        customer_name: 'Buyer',
        customer_phone: '08039999999',
        gift_wrapping_fee: 50,
        id: 'order-1',
        shipping_address: { address: '12 Allen Avenue' },
        tax_amount: 100,
        tax_basis: 'inclusive',
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useEditOrderController());

    return waitFor(() => {
      expect(result.current.total).toBe(1050);
    });
  });
});
