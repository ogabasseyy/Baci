import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchReceiptListItems,
  type ReceiptCustomerInfo,
} from './receipt-list-items';

const customer: ReceiptCustomerInfo = {
  first_name: 'Bassey',
  last_name: 'John',
  email: 'customer@example.com',
  phone: null,
};

function mockOrdersResponse(orders: Array<Record<string, unknown>>) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ orders }),
  } as Response);
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 'ORD-001',
    created_at: '2026-04-03T10:00:00.000Z',
    total: 100,
    amount_paid: 100,
    currency: 'NGN',
    payment_status: 'paid',
    payment_method: 'card',
    // A realistic archived legacy order: the list filters through the
    // standard archive predicate before mapping.
    shipping_status: 'shipped',
    items: [
      {
        id: 'item-1',
        name: 'Samsung Galaxy S26',
        variant_name: 'Titan Black',
        image_url: 'https://cdn.example.com/phone.png',
        quantity: 2,
        price: 50,
      },
    ],
    ...overrides,
  };
}

describe('fetchReceiptListItems', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns null when the response has no orders', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await expect(fetchReceiptListItems('ogabassey', customer)).resolves.toBe(
      null
    );
  });

  it('maps display labels, images, and device counts', async () => {
    mockOrdersResponse([baseOrder()]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item).toMatchObject({
      status: 'Paid',
      paymentStatus: 'paid',
      documentKind: null,
      firstProductName: 'Samsung Galaxy S26 (Titan Black)',
      firstProductImage: 'https://cdn.example.com/phone.png',
      additionalDeviceCount: 1,
    });
    expect(item.rawOrder).toMatchObject({
      payment_status: 'paid',
      customer_name: 'Bassey John',
      customer_email: 'customer@example.com',
    });
  });

  it('bills the modal to the order contact snapshot over the profile', async () => {
    mockOrdersResponse([
      baseOrder({
        customer_name: 'Ada Lovelace',
        customer_email: 'ada@example.com',
        customer_phone: '+2348000000003',
      }),
    ]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item.rawOrder).toMatchObject({
      customer_name: 'Ada Lovelace',
      customer_email: 'ada@example.com',
      customer_phone: '+2348000000003',
    });
  });

  it('carries the proforma kind for unresolved 325 orders', async () => {
    mockOrdersResponse([
      baseOrder({
        amount_paid: 0,
        payment_status: 'unpaid',
        payment_method: 'invoice',
        current_document_kind: 'invoice',
        invoice_type_code: '325',
      }),
    ]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item.documentKind).toBe('proforma');
    expect(item.status).toBe('Unpaid');
  });

  it('normalizes settled balances to paid renderer input', async () => {
    mockOrdersResponse([
      baseOrder({
        payment_status: 'partially_paid',
        current_document_kind: 'receipt',
      }),
    ]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item.status).toBe('Partially Paid');
    expect(item.documentKind).toBeNull();
    expect(item.rawOrder.payment_status).toBe('paid');
  });

  it('dates paid previews by the completing payment, not stale order dates', async () => {
    mockOrdersResponse([
      baseOrder({
        transaction_date: '2026-04-01T10:00:00.000Z',
        invoice_issue_date: '2026-04-01',
        receipt_completion_date: '2026-04-03T12:00:00.000Z',
      }),
    ]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item.rawOrder.transaction_date).toBe('2026-04-03T12:00:00.000Z');
    expect(item.rawOrder.invoice_issue_date).toBeUndefined();
    expect(item.date).toBe('4/3/2026');
  });

  it('keeps order dates for unpaid previews', async () => {
    mockOrdersResponse([
      baseOrder({
        amount_paid: 0,
        payment_status: 'unpaid',
        payment_method: 'invoice',
        current_document_kind: 'invoice',
        transaction_date: '2026-04-01T10:00:00.000Z',
        invoice_issue_date: '2026-04-01',
        receipt_completion_date: '2026-04-03T12:00:00.000Z',
      }),
    ]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(item.rawOrder.transaction_date).toBe('2026-04-01T10:00:00.000Z');
    expect(item.rawOrder.invoice_issue_date).toBe('2026-04-01');
    expect(item.date).toBe('4/1/2026');
  });

  it('falls back to NGN display for a malformed currency code', async () => {
    mockOrdersResponse([baseOrder({ currency: 'naira' })]);

    const [item] = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    mockOrdersResponse([baseOrder({ currency: 'NGN' })]);
    const [ngnItem] =
      (await fetchReceiptListItems('ogabassey', customer)) ?? [];

    expect(item.total).toBe(ngnItem.total);
    expect(item.balance).toBe(ngnItem.balance);
  });

  it('filters unavailable manual documents before mapping', async () => {
    mockOrdersResponse([
      baseOrder({
        id: 'order-unavailable',
        is_manual_order: true,
        manual_document_available: false,
        receipt_eligible: false,
      }),
      baseOrder({
        id: 'order-available',
        is_manual_order: true,
        manual_document_available: true,
        receipt_eligible: false,
      }),
    ]);

    const items = (await fetchReceiptListItems('ogabassey', customer)) ?? [];
    expect(items.map((item) => item.id)).toEqual(['order-available']);
  });
});
