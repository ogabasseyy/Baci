import { act, renderHook } from '@testing-library/react';
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
    date: new Date('2024-01-02T10:00:00.000Z'),
    setDate: vi.fn(),
    discount: 0,
    notes: '',
    orderItems,
    sameAsCustomer: true,
    selectedBranchId: 'branch-1',
    selectedChannel: 'physical',
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
    ...overrides,
  } as unknown as BaseController;
}

describe('useEditOrderController submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrderMock.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('submits the update payload for the current order id', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const setShowSuccessModal = vi.fn();
    const baseController = createBaseController({ setShowSuccessModal });
    useNewOrderControllerMock.mockReturnValue(baseController);
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      orderId: 'order-1',
      payload: expect.objectContaining({
        transaction_date: '2024-01-02T10:00:00.000Z',
        branch_id: 'branch-1',
        customer: {
          email: 'ada@example.com',
          id: 'customer-1',
          name: 'Ada Buyer',
          phone: '08030000000',
        },
        items: [
          expect.objectContaining({
            product_id: 'product-1',
            quantity: 2,
            variant_id: 'variant-1',
          }),
        ],
        notify_customer: false,
      }),
    });
    expect(setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('omits an unchanged creation-date fallback from legacy orders', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const date = new Date('2024-01-02T10:00:00.000Z');
    useNewOrderControllerMock.mockReturnValue(createBaseController({ date }));
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({
      data: { id: 'order-1', created_at: date.toISOString() },
      isLoading: false,
    });
    const { result } = renderHook(() => useEditOrderController());
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(mutateAsync.mock.calls[0][0].payload).not.toHaveProperty(
      'transaction_date'
    );
  });

  it('omits the date when the saved order has no parseable date', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: new Date(2024, 0, 5, 18, 30) })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({
      data: { created_at: 'not-a-date', id: 'order-1' },
      isLoading: false,
    });
    const { result } = renderHook(() => useEditOrderController());
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(mutateAsync.mock.calls[0][0].payload).not.toHaveProperty(
      'transaction_date'
    );
  });

  it('sends a changed day as local midnight', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: new Date(2024, 0, 5, 18, 30) })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({
      data: {
        id: 'order-1',
        transaction_date: new Date(2024, 0, 2, 10, 0).toISOString(),
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useEditOrderController());
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(mutateAsync.mock.calls[0][0].payload).toHaveProperty(
      'transaction_date',
      new Date(2024, 0, 5).toISOString()
    );
    expect(mutateAsync.mock.calls[0][0].payload).toHaveProperty(
      'transaction_date_day',
      '2024-01-05'
    );
  });

  it('blocks submission when a customer has not been selected', async () => {
    const mutateAsync = vi.fn();
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({
        customer: { address: '', email: '', id: null, name: '', phone: '' },
      })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith(
      'Required',
      'Please select a customer for this order'
    );
  });

  it('allows unlinked customer orders when a customer name is present', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({
        customer: {
          address: '1 Baci Road',
          email: '',
          id: null,
          name: 'Walk-in Buyer',
          phone: '',
        },
      })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      orderId: 'order-1',
      payload: expect.objectContaining({
        customer: expect.objectContaining({
          id: null,
          name: 'Walk-in Buyer',
        }),
      }),
    });
  });

  it('ignores submit taps while an update is already pending', async () => {
    const mutateAsync = vi.fn();
    useNewOrderControllerMock.mockReturnValue(createBaseController());
    useUpdateOrderMock.mockReturnValue({ isPending: true, mutateAsync });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('surfaces update errors through an alert', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Edit rejected'));
    useNewOrderControllerMock.mockReturnValue(createBaseController());
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(alertMock).toHaveBeenCalledWith('Error', 'Edit rejected');
  });

  it('submits financially locked orders so the API can enforce changed fields', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(createBaseController());
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({
      data: {
        amount_paid: 100,
        id: 'order-1',
        payment_status: 'paid',
        shipping_status: 'pending',
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useEditOrderController());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.isFinancialLocked).toBe(true);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' })
    );
  });
});
