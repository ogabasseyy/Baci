import { describe, expect, it } from 'vitest';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';
import { buildManualOrderDocumentPdfInput } from './build-manual-order-document-pdf-input';

const orderRow = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  order_number: 'ORD-42',
  created_at: '2026-09-28T10:00:00Z',
  transaction_date: null,
  invoice_issue_date: null,
  payment_due_date: null,
  payment_terms: null,
  buyer_reference: null,
  firs_irn: null,
  firs_csid: null,
  currency: 'NGN',
  total: 950000,
  subtotal: 950000,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 950000,
  payment_status: 'paid',
  payment_method: null,
  shipping_status: 'pending',
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: null,
  invoice_type_code: null,
  shipping_address: null,
  order_items: [
    {
      id: 'item-1',
      name: 'iPhone 16 Pro Max',
      quantity: 1,
      price: 950000,
      variant_name: null,
      condition: null,
      item_description: 'Desert titanium, sealed box',
    },
  ],
};

const merchantRow = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  email_sender_name: null,
  logo_url: null,
  email: 'hello@ogabassey.com',
  phone: null,
  support_email: null,
  support_phone: null,
  business_address: null,
  registered_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  vat_registration_status: null,
  vat_rate: null,
  bank_code: '044',
  bank_account_number: '1234567890',
  bank_name: 'Test Bank',
  bank_account_name: 'Ogabassey',
  brand_colors: null,
};

const paymentAccount = {
  account_number: '9876543210',
  bank_name: 'DVA Bank',
  account_name: 'Ada / ORD-42',
};

describe('buildManualOrderDocumentPdfInput', () => {
  it('normalizes null locality to undefined-absent addresses', () => {
    const order = manualDocumentOrderSchema.parse({
      ...orderRow,
      shipping_address: {
        city: null,
        state: null,
        postal_code: null,
        postalCode: null,
      },
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantRow);
    const { receiptOrder } = buildManualOrderDocumentPdfInput({
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
    });

    expect(receiptOrder.shipping_address?.city).toBeUndefined();
    expect(receiptOrder.shipping_address?.state).toBeUndefined();
    expect(receiptOrder.shipping_address?.postal_code).toBeUndefined();
  });

  it('maps items, balance, and the preferred virtual account', () => {
    const { receiptOrder, receiptMerchant } = buildManualOrderDocumentPdfInput({
      order: manualDocumentOrderSchema.parse(orderRow),
      merchant: manualDocumentMerchantSchema.parse(merchantRow),
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: paymentAccount,
    });

    expect(receiptOrder.balance).toBe(0);
    expect(receiptOrder.items).toEqual([
      expect.objectContaining({
        product_name: 'iPhone 16 Pro Max',
        description: 'Desert titanium, sealed box',
      }),
    ]);
    expect(receiptOrder.virtual_account).toEqual({
      account_number: '9876543210',
      bank_name: 'DVA Bank',
      account_name: 'Ada / ORD-42',
    });
    expect(receiptMerchant.bank_account_number).toBe('1234567890');
  });

  it('itemizes the assurance premium so emailed lines reconcile with totals', () => {
    const { receiptOrder } = buildManualOrderDocumentPdfInput({
      order: manualDocumentOrderSchema.parse({
        ...orderRow,
        order_items: [
          {
            ...orderRow.order_items[0],
            assurance_fee: 15000,
          },
        ],
      }),
      merchant: manualDocumentMerchantSchema.parse(merchantRow),
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: paymentAccount,
    });

    expect(receiptOrder.items).toHaveLength(2);
    expect(receiptOrder.items[1]).toMatchObject({
      product_name: 'Ogabassey Assurance',
      quantity: 1,
      price: 15000,
      vat_category_code: 'O',
      vat_amount: 0,
    });
  });

  it('hides naira bank details on foreign-currency documents', () => {
    const { receiptOrder, receiptMerchant } = buildManualOrderDocumentPdfInput({
      order: manualDocumentOrderSchema.parse({
        ...orderRow,
        currency: 'USD',
      }),
      merchant: manualDocumentMerchantSchema.parse(merchantRow),
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: paymentAccount,
    });

    expect(receiptOrder.virtual_account).toBeNull();
    expect(receiptMerchant.bank_code).toBeNull();
    expect(receiptMerchant.bank_account_number).toBeNull();
    expect(receiptMerchant.bank_name).toBeNull();
    expect(receiptMerchant.bank_account_name).toBeNull();
  });

  it('resolves blank bank names from the code for the PDF generator', () => {
    // The generator renders bank_name only: pass the unresolved blank
    // through and the attachment omits the bank entirely.
    const { receiptMerchant } = buildManualOrderDocumentPdfInput({
      order: manualDocumentOrderSchema.parse(orderRow),
      merchant: manualDocumentMerchantSchema.parse({
        ...merchantRow,
        bank_name: '',
      }),
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: paymentAccount,
    });

    expect(receiptMerchant.bank_name).toBe('Access Bank');
  });
});
