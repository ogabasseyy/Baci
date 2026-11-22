import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderItem } from '@/components/orders/new-order.types';
import { buildOrderGiglQuoteRequest } from '../../web/src/lib/shipping/build-order-gigl-quote-request';

const mocks = vi.hoisted(() => ({
  createManualOrderWithItems: vi.fn(),
  alert: vi.fn(),
  authenticatedFetch: vi.fn(),
  invalidateQueries: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
}));

vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  createAuthenticatedFetch: mocks.authenticatedFetch,
}));

vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.invalid' }));

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

import { getOrderGiglQuote } from '@/lib/order-gigl-shipping';
import { createNewOrderCustomerActions } from './createNewOrderCustomerActions';
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

  it('uses the address entered for an existing customer from manual order creation through the GIG quote', async () => {
    const setCustomer = vi.fn();
    const destination = {
      address: '10 Hospital Road',
      city: 'Lokoja',
      state: 'Kogi',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 7.8,
      longitude: 6.7,
    };
    const actions = createNewOrderCustomerActions({
      createCustomer: vi.fn(),
      merchantId: 'merchant-1',
      newCustomer: {
        ...destination,
        companyName: '',
        customerType: 'individual',
        email: '',
        firstName: 'Ada',
        lastName: '',
        phone: '08030000000',
      },
      setCustomer,
      setCustomerSearch: vi.fn(),
      setDuplicateCustomer: vi.fn(),
      setIsCreatingCustomer: vi.fn(),
      setNewCustomer: vi.fn(),
      setSelectedCountryCode: vi.fn(),
      setShowCustomerModal: vi.fn(),
    });
    actions.handleSelectCustomer(
      {
        id: 'customer-1',
        address: null,
        company_name: null,
        customer_type: 'individual',
        first_name: 'Ada',
        full_name: 'Ada Merchant',
        last_name: 'Merchant',
        phone: '08030000000',
        email: null,
      },
      true
    );

    await submitNewOrder(
      createSubmitParams({
        customer: setCustomer.mock.lastCall?.[0],
        selectedBranchId: null,
        selectedChannel: 'physical',
      })
    );

    const persisted = mocks.createManualOrderWithItems.mock.lastCall?.[1];
    expect(persisted.order.shipping_address).toMatchObject(destination);
    const provider = vi.fn().mockResolvedValue({
      quote: {
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics',
        estimatedDays: 2,
        price: 10900,
        currency: 'NGN',
        pickupIncluded: true,
        insuranceIncluded: false,
        expiresAt: '2026-07-02T13:00:00.000Z',
      },
      availableBalance: 20000,
      shortfall: 0,
      canBook: true,
    });
    mocks.authenticatedFetch.mockImplementationOnce(
      async (url: string, options: RequestInit) => {
        expect(url).toContain('/orders/order-1/shipping/gigl-quote');
        expect(JSON.parse(String(options.body))).toEqual({});
        const built = await buildOrderGiglQuoteRequest(
          {
            ...persisted.order,
            id: 'order-1',
            order_items: persisted.buildItems('order-1'),
          },
          {
            name: 'Store',
            address: '1 Store Road',
            city: 'Ikeja',
            state: 'Lagos',
            phone: '08040000000',
            country: 'Nigeria',
            countryCode: 'NG',
          }
        );
        expect(built.ok).toBe(true);
        if (!built.ok) throw new Error(built.code);
        return Response.json(await provider(built.request));
      }
    );

    const quote = await getOrderGiglQuote('order-1');
    expect(quote.quote.price).toBe(10900);
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        receiver: expect.objectContaining({
          ...destination,
          phone: '08030000000',
        }),
        items: [expect.objectContaining({ name: 'Phone', quantity: 1 })],
      })
    );
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

    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(8);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['monthly-transaction-count', 'merchant-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['transaction-review', 'merchant-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['analytics-overview'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['analytics-detail'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['top-selling-products'],
    });
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

  it('marks picker document dates explicit so triggers preserve the local day', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      // Device wall time just past local midnight in Auckland (UTC+13 in
      // March): the UTC instant already falls on March 4, but the selected
      // calendar day stays authoritative and must not be recomputed.
      const selectedOrderDate = new Date(2026, 2, 5, 0, 30);
      expect(selectedOrderDate.toISOString().slice(0, 10)).toBe('2026-03-04');

      await submitNewOrder(
        createSubmitParams({
          orderDate: selectedOrderDate,
        })
      );

      expect(mocks.createManualOrderWithItems).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          order: expect.objectContaining({
            transaction_date: selectedOrderDate.toISOString(),
            invoice_issue_date: '2026-03-05',
            tax_point_date: '2026-03-05',
            invoice_issue_date_generated: false,
            tax_point_date_generated: false,
          }),
        })
      );
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
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
