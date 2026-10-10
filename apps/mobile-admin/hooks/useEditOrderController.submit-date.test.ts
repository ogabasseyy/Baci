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

describe('useEditOrderController submit date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrderMock.mockReturnValue({ data: undefined, isLoading: false });
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

  it('blocks a future pick inline before submit', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: tomorrow })
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
    expect(alertMock).toHaveBeenCalledWith(
      'Invalid date',
      'Order date cannot be in the future.'
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('alerts instead of silently omitting an unreadable date', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: new Date('not-a-date') })
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
    expect(alertMock).toHaveBeenCalledWith(
      'Invalid date',
      'The selected date is invalid. Please pick the date again.'
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('alerts on an unreadable date while the order is loading', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: new Date('not-a-date') })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useEditOrderController());
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(alertMock).toHaveBeenCalledWith(
      'Invalid date',
      'The selected date is invalid. Please pick the date again.'
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('omits a manual day matching the stored explicit day', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useNewOrderControllerMock.mockReturnValue(
      createBaseController({ date: new Date(2024, 0, 5, 18, 30) })
    );
    useUpdateOrderMock.mockReturnValue({ isPending: false, mutateAsync });
    useOrderMock.mockReturnValue({
      data: {
        id: 'order-1',
        invoice_issue_date: '2024-01-05',
        source: 'physical',
        transaction_date: new Date(2024, 0, 4, 23, 30).toISOString(),
      },
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
});
