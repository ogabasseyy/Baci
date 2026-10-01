import { describe, expect, it, vi } from 'vitest';
import {
  createFailedPayload,
  createOrdersEconomicsSelectMock,
  createSuccessPayload,
  createWebhookRequest,
  getMockCreateServerClient,
  isOrdersEconomicsSelect,
  mockAdminSupabase,
  mockSupabase,
  pendingCryptoTxn,
  setupJuicywayWebhookTest,
  wireProcessingMocks,
  wrapOrdersTableMock,
} from './route.test-helpers';

type ChainFn = (...args: unknown[]) => unknown;

describe('isOrdersEconomicsSelect', () => {
  it('detects economics column projections', () => {
    expect(
      isOrdersEconomicsSelect(
        'id, shipping_platform_retained_amount, shipping_fee'
      )
    ).toBe(true);
  });

  it('rejects non-string or non-economics projections', () => {
    expect(isOrdersEconomicsSelect('id, shipping_fee')).toBe(false);
    expect(isOrdersEconomicsSelect(null)).toBe(false);
    expect(isOrdersEconomicsSelect(12)).toBe(false);
  });
});

describe('createOrdersEconomicsSelectMock', () => {
  it('returns chainable eq and maybeSingle with economics data', async () => {
    const economics = { shipping_platform_retained_amount: 250 };
    const mock = createOrdersEconomicsSelectMock(economics);

    expect(mock.eq('id', 'order-1')).toBe(mock);
    await expect(mock.maybeSingle()).resolves.toEqual({
      data: economics,
      error: null,
    });
  });

  it('defaults economics data to null', async () => {
    const mock = createOrdersEconomicsSelectMock();
    await expect(mock.maybeSingle()).resolves.toEqual({
      data: null,
      error: null,
    });
  });
});

describe('wrapOrdersTableMock', () => {
  it('routes economics selects to the economics mock', async () => {
    const baseSelect = vi.fn().mockReturnValue({ kind: 'base' });
    const wrapped = wrapOrdersTableMock(
      { select: baseSelect },
      { shipping_platform_retained_amount: 100 }
    );

    const economics = wrapped.select(
      'id, shipping_platform_retained_amount'
    ) as ReturnType<typeof createOrdersEconomicsSelectMock>;

    expect(baseSelect).not.toHaveBeenCalled();
    await expect(economics.maybeSingle()).resolves.toEqual({
      data: { shipping_platform_retained_amount: 100 },
      error: null,
    });
  });

  it('delegates non-economics selects to the wrapped table mock', () => {
    const baseSelect = vi.fn().mockReturnValue({ kind: 'base' });
    const wrapped = wrapOrdersTableMock({ select: baseSelect });

    expect(wrapped.select('id, status')).toEqual({ kind: 'base' });
    expect(baseSelect).toHaveBeenCalledWith('id, status');
  });
});

describe('webhook payload and request helpers', () => {
  it('builds a success payload with the requested reference', () => {
    const payload = createSuccessPayload('TXN-999');

    expect(payload.event).toBe('payment.session.succeeded');
    expect(payload.data.reference).toBe('TXN-999');
    expect(payload.data.status).toBe('success');
  });

  it('builds a failed payload', () => {
    const payload = createFailedPayload();

    expect(payload.event).toBe('payment.session.failed');
    expect(payload.data.status).toBe('failed');
    expect(payload.data.reference).toBe('TXN-FAILED');
  });

  it('creates a POST webhook request carrying the payload', async () => {
    const payload = createSuccessPayload();
    const request = createWebhookRequest(payload);

    expect(request.method).toBe('POST');
    expect(request.url).toContain('/api/payments/juicyway/webhook');
    await expect(request.json()).resolves.toEqual(payload);
  });

  it('builds a pending crypto transaction fixture', () => {
    expect(pendingCryptoTxn({ channel: 'crypto' })).toMatchObject({
      id: 'txn-123',
      status: 'pending',
      gateway_reference: 'TXN-123456',
      metadata: { channel: 'crypto' },
    });
  });
});

describe('setupJuicywayWebhookTest and wireProcessingMocks', () => {
  it('wires the server client mock and wraps orders table selects', async () => {
    await setupJuicywayWebhookTest();

    expect(getMockCreateServerClient().getMockImplementation()?.()).toBe(
      mockSupabase
    );

    const orders = mockSupabase.from('orders') as {
      select: (columns?: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
      };
    };
    await expect(
      orders.select('id, shipping_platform_retained_amount').maybeSingle()
    ).resolves.toEqual({ data: null, error: null });

    const reconciliation = mockAdminSupabase.from('reconciliation_review') as {
      insert: ReturnType<typeof vi.fn>;
    };
    expect(reconciliation.insert).toBeTypeOf('function');
  });

  it('tracks transaction and order updates through processing mocks', async () => {
    await setupJuicywayWebhookTest();
    const state = wireProcessingMocks(pendingCryptoTxn({ channel: 'crypto' }), {
      orderItems: [
        {
          id: 'item-1',
          name: 'Phone',
          price: 10_000,
          product_id: 'p1',
          quantity: 1,
          subtotal: 10_000,
          condition: null,
          variant_name: null,
        },
      ],
    });

    const firstTxn = mockSupabase.from('transactions') as {
      select: () => {
        eq: ChainFn;
        single: () => Promise<{ data: unknown; error: null }>;
      };
    };
    const firstTxnSelect = firstTxn.select() as {
      eq: ChainFn;
    };
    const firstTxnEq = firstTxnSelect.eq('id', 'txn-123') as {
      single: () => Promise<{ data: unknown; error: null }>;
    };
    await expect(firstTxnEq.single()).resolves.toMatchObject({
      data: expect.objectContaining({ id: 'txn-123' }),
      error: null,
    });

    const secondTxn = mockSupabase.from('transactions') as {
      update: () => { eq: ChainFn };
    };
    await (secondTxn.update().eq as ChainFn)('id', 'txn-123');
    expect(state.txnUpdated).toBe(true);

    const orders = mockSupabase.from('orders') as {
      update: () => {
        eq: ChainFn;
      };
    };
    const afterEq = orders.update().eq('id', 'order-123') as {
      neq: ChainFn;
    };
    const afterNeq = afterEq.neq('status', 'cancelled') as {
      select: () => {
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
      };
    };
    await expect(afterNeq.select().maybeSingle()).resolves.toMatchObject({
      data: expect.objectContaining({ id: 'order-123' }),
      error: null,
    });
    expect(state.orderUpdated).toBe(true);

    const merchants = mockAdminSupabase.from('merchants') as unknown as {
      select: () => {
        eq: ChainFn;
      };
    };
    const merchantEq = merchants.select().eq('id', 'merchant-123') as {
      single: () => Promise<{ data: { slug: string }; error: null }>;
    };
    await expect(merchantEq.single()).resolves.toMatchObject({
      data: expect.objectContaining({ slug: 'test-store' }),
      error: null,
    });
  });
});
