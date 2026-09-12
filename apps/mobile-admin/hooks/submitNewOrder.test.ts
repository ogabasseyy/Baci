import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderItem } from '@/components/orders/new-order.types';

const mocks = vi.hoisted(() => ({
  createManualOrderWithItems: vi.fn(),
  alert: vi.fn(),
  invalidateQueries: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
}));

vi.mock('@/lib/manual-order-persistence', () => ({
  createManualOrderWithItems: mocks.createManualOrderWithItems,
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'uuid-123456',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.supabaseFrom,
  },
}));

import { submitNewOrder } from './submitNewOrder';

type SubmitNewOrderParams = Parameters<typeof submitNewOrder>[0];

type BranchLookupResponse = {
  data: { id: string } | null;
  error: { message: string } | null;
};

function createBranchQuery(response: BranchLookupResponse) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function createOrderItem(overrides: Partial<OrderItem>): OrderItem {
  return {
    id: 'item-1',
    name: 'Phone',
    price: 0,
    product_id: 'product-1',
    quantity: 1,
    variant_id: null,
    variant_name: null,
    ...overrides,
  };
}

function createSubmitParams(
  overrides: Partial<SubmitNewOrderParams> = {}
): SubmitNewOrderParams {
  return {
    customer: {
      address: '1 Baci Street',
      email: 'customer@example.com',
      id: 'customer-1',
      name: 'Ada Merchant',
      phone: '08030000000',
    },
    deliveryInfo: { address: '', city: '', name: '', phone: '', state: '' },
    discount: 0,
    merchantCurrency: 'NGN',
    merchantId: 'merchant-1',
    notes: 'Handle with care',
    orderDate: new Date(2024, 1, 3, 10, 30),
    orderItems: [createOrderItem({ price: 12000, variant_name: 'Blue' })],
    partialAmount: '',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    queryClient: {
      invalidateQueries: mocks.invalidateQueries,
    } as unknown as QueryClient,
    sameAsCustomer: true,
    selectedBranchId: 'branch-1',
    selectedChannel: 'website',
    setIsSubmitting: vi.fn(),
    setLastOrderId: vi.fn(),
    setShowSuccessModal: vi.fn(),
    shippingFee: 0,
    subtotal: 12000,
    submittingRef: { current: false },
    taxesToUse: 0,
    total: 12000,
    userId: 'user-1',
    ...overrides,
  };
}

describe('submitNewOrder', () => {
  let branchQuery: ReturnType<typeof createBranchQuery>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.createManualOrderWithItems.mockResolvedValue({ id: 'order-1' });
    branchQuery = createBranchQuery({
      data: { id: 'branch-1' },
      error: null,
    });
    mocks.supabaseFrom.mockReturnValue(branchQuery);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks submission when the customer is missing', async () => {
    await submitNewOrder(
      createSubmitParams({
        customer: { address: '', email: '', id: null, name: '', phone: '' },
        orderItems: [],
      })
    );

    expect(mocks.alert).toHaveBeenCalledWith(
      'Required',
      'Please select a customer for this order'
    );
    expect(mocks.createManualOrderWithItems).not.toHaveBeenCalled();
  });

  it('creates the order, invalidates queries, and shows success', async () => {
    const setIsSubmitting = vi.fn();
    const setLastOrderId = vi.fn();
    const setShowSuccessModal = vi.fn();
    const params = createSubmitParams({
      setIsSubmitting,
      setLastOrderId,
      setShowSuccessModal,
    });

    await submitNewOrder(params);

    expect(mocks.supabaseFrom).toHaveBeenCalledWith('branches');
    expect(branchQuery.select).toHaveBeenCalledWith('id');
    expect(branchQuery.eq).toHaveBeenCalledWith('id', 'branch-1');
    expect(branchQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(branchQuery.eq).toHaveBeenCalledWith('active', true);
    expect(mocks.createManualOrderWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteOrder: expect.any(Function),
        insertOrder: expect.any(Function),
        insertOrderItems: expect.any(Function),
      }),
      expect.objectContaining({
        buildItems: expect.any(Function),
        order: expect.objectContaining({
          amount_paid: 12000,
          branch_id: 'branch-1',
          currency: 'NGN',
          customer_email: 'customer@example.com',
          customer_id: 'customer-1',
          customer_name: 'Ada Merchant',
          customer_phone: '08030000000',
          discount_amount: 0,
          merchant_id: 'merchant-1',
          notes: 'Handle with care',
          order_number: 'ORD-030224-UUID12',
          payment_method: 'cash',
          payment_status: 'paid',
          recorded_by_user_id: 'user-1',
          shipping_address: expect.objectContaining({
            address: '1 Baci Street',
            name: 'Ada Merchant',
            phone: '08030000000',
          }),
          shipping_fee: 0,
          shipping_status: 'pending',
          source: 'website',
          subtotal: 12000,
          tax_amount: 0,
          total: 12000,
          transaction_date: params.orderDate.toISOString(),
          invoice_issue_date: '2024-02-03',
          tax_point_date: '2024-02-03',
        }),
      })
    );

    const orderPayload = mocks.createManualOrderWithItems.mock.calls[0][1] as {
      order: Record<string, unknown>;
    };
    expect(orderPayload.order).not.toHaveProperty('created_at');

    const payload = mocks.createManualOrderWithItems.mock.calls[0][1] as {
      buildItems: (orderId: string) => unknown[];
    };
    const items = payload.buildItems('order-1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Phone',
      price: 12000,
      product_match_status: 'linked',
      quantity: 1,
      order_id: 'order-1',
      variant_attributes: {},
      variant_name: null,
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(setLastOrderId).toHaveBeenCalledWith('order-1');
    expect(setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(setIsSubmitting).toHaveBeenCalledWith(true);
    expect(setIsSubmitting).toHaveBeenLastCalledWith(false);
  });

  it('normalizes unsupported merchant currencies before saving orders', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await submitNewOrder(
      createSubmitParams({
        merchantCurrency: 'ABC',
      })
    );

    expect(mocks.createManualOrderWithItems).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        order: expect.objectContaining({
          currency: 'NGN',
        }),
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[submitNewOrder] Unsupported merchant currency fallback',
      {
        fallbackCurrency: 'NGN',
        merchantCurrency: 'ABC',
      }
    );
    warnSpy.mockRestore();
  });

  it('normalizes lowercase merchant currencies before saving orders', async () => {
    await submitNewOrder(
      createSubmitParams({
        merchantCurrency: 'egp',
      })
    );

    expect(mocks.createManualOrderWithItems).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        order: expect.objectContaining({
          currency: 'EGP',
        }),
      })
    );
  });

  it('rejects future order dates before creating an order', async () => {
    await submitNewOrder(
      createSubmitParams({
        orderDate: new Date('2026-07-02T12:02:00.000Z'),
      })
    );

    expect(mocks.createManualOrderWithItems).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Order date cannot be in the future'
    );
  });

  it('uses the selected local order date for the order number date segment', async () => {
    const selectedOrderDate = new Date(2024, 1, 3, 0, 30);

    await submitNewOrder(
      createSubmitParams({
        orderDate: selectedOrderDate,
      })
    );

    expect(mocks.createManualOrderWithItems).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        order: expect.objectContaining({
          order_number: 'ORD-030224-UUID12',
          transaction_date: selectedOrderDate.toISOString(),
        }),
      })
    );
  });

  it('preserves custom match status and selected variant attributes', async () => {
    await submitNewOrder(
      createSubmitParams({
        orderItems: [
          createOrderItem({
            is_custom: true,
            price: 20000,
            product_id: null,
            product_match_status: 'unreviewed',
            variant_id: null,
            variant_name: null,
          }),
          createOrderItem({
            price: 20000,
            product_id: 'product-1',
            variant_attributes: { color: 'Blue', storage: '512GB' },
            variant_id: 'variant-1',
            variant_name: 'Blue / 512GB',
          }),
        ],
      })
    );

    const payload = mocks.createManualOrderWithItems.mock.calls[0][1] as {
      buildItems: (orderId: string) => Array<{
        product_match_status: string;
        variant_attributes: unknown;
      }>;
    };
    const [customItem, variantItem] = payload.buildItems('order-1');

    expect(customItem).toMatchObject({
      product_match_status: 'unreviewed',
      variant_attributes: {},
    });
    expect(variantItem?.variant_attributes).toEqual({
      color: 'Blue',
      storage: '512GB',
    });
  });

  it('handles createManualOrderWithItems failure gracefully', async () => {
    const setIsSubmitting = vi.fn();
    const setLastOrderId = vi.fn();
    const setShowSuccessModal = vi.fn();
    mocks.createManualOrderWithItems.mockRejectedValueOnce(
      new Error('Create failed')
    );

    await submitNewOrder(
      createSubmitParams({
        setIsSubmitting,
        setLastOrderId,
        setShowSuccessModal,
      })
    );

    expect(mocks.alert).toHaveBeenCalledWith('Error', 'Create failed');
    expect(setIsSubmitting).toHaveBeenLastCalledWith(false);
    expect(setShowSuccessModal).not.toHaveBeenCalled();
    expect(setLastOrderId).not.toHaveBeenCalled();
  });

  it('rejects a selected branch that is not active for the merchant', async () => {
    const setIsSubmitting = vi.fn();
    branchQuery = createBranchQuery({ data: null, error: null });
    mocks.supabaseFrom.mockReturnValue(branchQuery);

    await submitNewOrder(
      createSubmitParams({
        selectedBranchId: 'branch-from-another-merchant',
        setIsSubmitting,
      })
    );

    expect(mocks.supabaseFrom).toHaveBeenCalledWith('branches');
    expect(branchQuery.eq).toHaveBeenCalledWith(
      'id',
      'branch-from-another-merchant'
    );
    expect(branchQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(branchQuery.eq).toHaveBeenCalledWith('active', true);
    expect(mocks.createManualOrderWithItems).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Selected branch is not available for this merchant'
    );
    expect(setIsSubmitting).toHaveBeenLastCalledWith(false);
  });
});
