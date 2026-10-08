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

  it('prefills the new-order controller from loaded order details', async () => {
    const baseController = createBaseController();
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        transaction_date: '2024-01-02T10:00:00.000Z',
        created_at: '2026-10-08T10:00:00.000Z',
        branch_id: 'branch-2',
        customer_email: 'buyer@example.com',
        customer_id: 'customer-2',
        customer_name: 'Buyer',
        customer_phone: '08039999999',
        discount_amount: 100,
        id: 'order-1',
        items: [
          {
            id: 'line-1',
            item_description: 'Open box',
            name: 'Phone',
            price: 2000,
            product_id: 'product-1',
            quantity: 1,
            variant_attributes: { color: 'Black' },
            variant_id: 'variant-1',
            variant_name: 'Black',
          },
        ],
        notes: 'Handle gently',
        shipping_address: {
          address: '12 Allen Avenue',
          city: 'Ikeja',
          name: 'Receiver',
          phone: '08030000000',
          state: 'Lagos',
        },
        shipping_fee: 500,
        source: 'website',
        tax_amount: 75,
        tax_basis: 'exclusive',
      },
      isLoading: false,
    });

    renderHook(() => useEditOrderController());
    expect(baseController.setDate).toHaveBeenCalledWith(
      new Date('2024-01-02T10:00:00.000Z')
    );

    expect(useNewOrderControllerMock).toHaveBeenCalledWith({
      autoApplyVat: false,
      autoSelectDefaultBranch: false,
      initialSelectedChannel: null,
    });
    await waitFor(() => {
      expect(baseController.setCustomer).toHaveBeenCalledWith({
        address: '12 Allen Avenue',
        email: 'buyer@example.com',
        id: 'customer-2',
        name: 'Buyer',
        phone: '08039999999',
      });
    });
    expect(baseController.setSelectedBranchId).toHaveBeenCalledWith('branch-2');
    expect(baseController.setSelectedChannel).toHaveBeenCalledWith('website');
    expect(baseController.setTaxes).toHaveBeenCalledWith(75);
    expect(baseController.setIsVatApplied).toHaveBeenCalledWith(false);
    expect(baseController.setOrderItems).toHaveBeenCalledWith([
      expect.objectContaining({
        details: 'Open box',
        product_id: 'product-1',
        variant_id: 'variant-1',
      }),
    ]);
    expect(baseController.setNotes).toHaveBeenCalledWith('Handle gently');
    expect(baseController.setShippingFee).toHaveBeenCalledWith(500);
    expect(baseController.setSameAsCustomer).toHaveBeenCalledWith(false);
    expect(baseController.setDeliveryInfo).toHaveBeenCalledWith({
      address: '12 Allen Avenue',
      city: 'Ikeja',
      name: 'Receiver',
      phone: '08030000000',
      state: 'Lagos',
    });
  });

  it('prefills manual orders from the stored explicit day', () => {
    const baseController = createBaseController();
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    useOrderMock.mockReturnValue({
      data: {
        created_at: new Date(2024, 0, 4, 23, 30).toISOString(),
        id: 'order-1',
        invoice_issue_date: '2024-01-05',
        source: 'physical',
        transaction_date: new Date(2024, 0, 4, 23, 30).toISOString(),
      },
      isLoading: false,
    });

    renderHook(() => useEditOrderController());

    expect(baseController.setDate).toHaveBeenCalledWith(new Date(2024, 0, 5));
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
