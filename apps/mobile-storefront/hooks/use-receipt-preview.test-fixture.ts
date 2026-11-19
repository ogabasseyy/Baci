// Shared detail builders for the useReceiptPreview suites. Kept free of
// jest state (each suite owns its module mock) so both files stay small.
export function unpaidProformaDetail(
  currency: string
): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    created_at: '2026-09-01T10:00:00.000Z',
    currency,
    total: 500,
    subtotal: 500,
    shipping_fee: 0,
    tax_amount: 0,
    discount_amount: 0,
    amount_paid: 0,
    balance: 500,
    payment_status: 'unpaid',
    payment_method: 'invoice',
    notes: null,
    is_credit_order: false,
    customer_name: 'Ada Buyer',
    customer_email: 'ada@example.com',
    customer_phone: null,
    shipping_address: null,
    virtual_account: null,
    items: [],
    transactions: [],
  };
}

const coveredItem = {
  id: 'item-1',
  name: 'Device',
  product_name: 'Device',
  quantity: 1,
  price: 500,
};

export function coveredManualDetail(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...unpaidProformaDetail('NGN'),
    payment_status: 'pending',
    total: 500,
    amount_paid: 500,
    recorded_by_user_id: 'staff-1',
    import_job_id: null,
    external_source: null,
    items: [coveredItem],
    ...overrides,
  };
}
