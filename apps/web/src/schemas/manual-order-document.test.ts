import { describe, expect, it } from 'vitest';
import {
  manualDocumentClaimSchema,
  manualDocumentMerchantSchema,
  manualDocumentOrderSchema,
} from './manual-order-document';

const baseOrder = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  recorded_by_user_id: 'user-1',
  import_job_id: null,
  external_source: null,
  order_number: '1001',
  created_at: '2026-09-30T10:00:00.000Z',
  transaction_date: null,
  invoice_issue_date: null,
  currency: 'NGN',
  total: 5000,
  subtotal: 4500,
  shipping_fee: 500,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 5000,
  payment_status: 'paid',
  payment_method: 'transfer',
  shipping_status: 'pending',
  customer_name: 'Bassey John',
  customer_email: 'basseybjohn@yahoo.co.uk',
  customer_phone: null,
  shipping_address: null,
  order_items: [
    {
      id: 'item-1',
      name: 'Phone',
      quantity: 1,
      price: 4500,
      variant_name: null,
      condition: 'new',
    },
  ],
};

const baseMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  custom_domain: null,
  email_sender_name: null,
  logo_url: null,
  email: 'support@ogabassey.com',
  phone: null,
  support_email: null,
  support_phone: null,
  business_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
  bank_name: null,
  bank_account_name: null,
  brand_colors: null,
};

describe('manualDocumentOrderSchema', () => {
  it('accepts a manual order row with coerced totals', () => {
    const parsed = manualDocumentOrderSchema.parse({
      ...baseOrder,
      total: '5000',
    });

    expect(parsed.order_number).toBe('1001');
    expect(parsed.total).toBe(5000);
    expect(parsed.order_items).toHaveLength(1);
  });

  it('rejects negative totals and empty item quantities', () => {
    expect(() =>
      manualDocumentOrderSchema.parse({ ...baseOrder, total: -1 })
    ).toThrow();
    expect(() =>
      manualDocumentOrderSchema.parse({
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], quantity: 0 }],
      })
    ).toThrow();
  });
});

describe('manualDocumentMerchantSchema', () => {
  it('accepts a merchant row with nullable branding', () => {
    const parsed = manualDocumentMerchantSchema.parse(baseMerchant);

    expect(parsed.slug).toBe('ogabassey');
    expect(parsed.brand_colors).toBeNull();
  });

  it('requires merchant contact identity', () => {
    expect(() =>
      manualDocumentMerchantSchema.parse({ ...baseMerchant, email: undefined })
    ).toThrow();
  });
});

describe('manualDocumentClaimSchema', () => {
  it('accepts created and skipped claim outcomes', () => {
    expect(
      manualDocumentClaimSchema.parse({
        status: 'created',
        claim_id: 'claim-1',
        customer_id: 'customer-1',
        customer_email: 'basseybjohn@yahoo.co.uk',
      })
    ).toMatchObject({ status: 'created' });
    expect(manualDocumentClaimSchema.parse({ status: 'skipped' })).toEqual({
      status: 'skipped',
    });
  });

  it('rejects created claims without a customer binding', () => {
    expect(() =>
      manualDocumentClaimSchema.parse({
        status: 'created',
        claim_id: '',
        customer_id: 'customer-1',
        customer_email: 'basseybjohn@yahoo.co.uk',
      })
    ).toThrow();
  });
});
