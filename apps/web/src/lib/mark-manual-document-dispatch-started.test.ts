import { describe, expect, it, vi } from 'vitest';
import { markManualDocumentDispatchStarted } from './mark-manual-document-dispatch-started';

const row = {
  id: 'outbox-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  claim_owner: 'worker-1',
  event_type: 'manual_order_receipt_ready',
};
const order = {
  customer_id: 'customer-1',
  customer_email: 'ada@example.com',
  customer_name: 'Ada',
  customer_phone: null,
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  total: 100,
  subtotal: 100,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 100,
  currency: 'NGN',
  order_number: 'ORD-1',
  payment_status: 'paid',
  payment_method: 'bank_transfer',
  shipping_status: 'pending',
  invoice_type_code: null,
  invoice_note: null,
  notes: 'Call first',
  transaction_date: '2026-09-28T09:00:00Z',
  invoice_issue_date: null,
  created_at: '2026-09-30T09:00:00Z',
  shipping_address: { city: 'Lagos', postalCode: '100001' },
  order_items: [
    {
      id: 'item-1',
      name: 'Device',
      quantity: 1,
      price: 100,
      variant_name: null,
      condition: 'new',
      item_description: 'Sealed box',
    },
  ],
};
const taxSubtotals = [
  {
    id: 'tax-2',
    vat_category_code: 'E',
    vat_rate: 0,
    taxable_amount: 50000,
    tax_amount: 0,
    exemption_reason: 'exports',
  },
  {
    id: 'tax-1',
    vat_category_code: 'S',
    vat_rate: 7.5,
    taxable_amount: 100000,
    tax_amount: 7500,
    exemption_reason: null,
  },
];
const transactions = [
  {
    id: 'txn-2',
    amount: 50000,
    created_at: '2026-09-30T09:00:00+00:00',
    description: 'balance',
    metadata: null,
  },
  {
    id: 'txn-1',
    amount: 50000,
    created_at: '2026-09-29T09:00:00+00:00',
    description: null,
    metadata: { payment_method: 'bank_transfer' },
  },
];
const payment = {
  merchantBankCode: '058',
  merchantBankAccountNumber: '1234567890',
  merchantBankName: 'GTBank',
  merchantBankAccountName: 'Shop Ltd',
  virtualAccountNumber: '9990001111',
  virtualAccountBankName: 'Paystack-Titan',
  virtualAccountName: 'Shop Ltd/ORD',
};

const merchant = {
  businessName: 'Shop Ltd',
  legalEntityName: 'Shop Ltd',
  businessAddress: '1 Market St',
  registeredAddress: null,
  cacRcNumber: 'RC123',
  taxIdentificationNumber: 'TIN123',
  vatRegistrationStatus: 'registered',
  vatRate: 7.5,
  supportEmail: 'support@shop.example.com',
  supportPhone: '+2348000000001',
  phone: '+2348000000002',
  slug: 'shop',
  emailSenderName: null,
  logoUrl: null,
  brandColors: null,
};

describe('markManualDocumentDispatchStarted', () => {
  it('passes the rendered snapshot to the atomic dispatch RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'marked' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt',
        payment,
        taxSubtotals,
        transactions,
        merchant,
        'shop.example.com'
      )
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('mark_manual_document_dispatch_started', {
      p_outbox_id: 'outbox-1',
      p_claim_owner: 'worker-1',
      p_customer_id: 'customer-1',
      p_customer_email: 'ada@example.com',
      p_customer_name: 'Ada',
      p_customer_phone: null,
      p_recorded_by_user_id: 'staff-1',
      p_import_job_id: null,
      p_external_source: null,
      p_document_kind: 'receipt',
      p_total: 100,
      p_subtotal: 100,
      p_shipping_fee: 0,
      p_tax_amount: 0,
      p_discount_amount: 0,
      p_amount_paid: 100,
      p_currency: 'NGN',
      p_order_number: 'ORD-1',
      p_payment_status: 'paid',
      p_payment_method: 'bank_transfer',
      p_shipping_status: 'pending',
      p_invoice_type_code: null,
      p_invoice_note: null,
      p_notes: 'Call first',
      p_transaction_date: '2026-09-28T09:00:00Z',
      p_invoice_issue_date: null,
      p_shipping_address: { city: 'Lagos', postalCode: '100001' },
      p_item_count: 1,
      p_merchant_bank_code: '058',
      p_merchant_bank_account_number: '1234567890',
      p_merchant_bank_name: 'GTBank',
      p_merchant_bank_account_name: 'Shop Ltd',
      p_merchant_business_name: 'Shop Ltd',
      p_merchant_legal_entity_name: 'Shop Ltd',
      p_merchant_business_address: '1 Market St',
      p_merchant_registered_address: null,
      p_merchant_cac_rc_number: 'RC123',
      p_merchant_tax_identification_number: 'TIN123',
      p_merchant_vat_registration_status: 'registered',
      p_merchant_vat_rate: 7.5,
      p_claim_domain: 'shop.example.com',
      p_merchant_support_email: 'support@shop.example.com',
      p_merchant_support_phone: '+2348000000001',
      p_merchant_phone: '+2348000000002',
      p_merchant_slug: 'shop',
      p_merchant_email_sender_name: null,
      p_merchant_logo_url: null,
      p_merchant_brand_colors: null,
      p_order_created_at: '2026-09-30T09:00:00Z',
      p_va_account_number: '9990001111',
      p_va_bank_name: 'Paystack-Titan',
      p_va_account_name: 'Shop Ltd/ORD',
      p_items: [
        {
          id: 'item-1',
          name: 'Device',
          quantity: 1,
          price: 100,
          variant_name: null,
          condition: 'new',
          item_description: 'Sealed box',
        },
      ],
      p_tax_count: 2,
      p_tax_subtotals: [
        {
          vat_category_code: 'S',
          vat_rate: 7.5,
          taxable_amount: 100000,
          tax_amount: 7500,
          exemption_reason: null,
        },
        {
          vat_category_code: 'E',
          vat_rate: 0,
          taxable_amount: 50000,
          tax_amount: 0,
          exemption_reason: 'exports',
        },
      ],
      p_txn_count: 2,
      p_transactions: [
        {
          amount: 50000,
          created_at: '2026-09-29T09:00:00+00:00',
          description: null,
          metadata: { payment_method: 'bank_transfer' },
        },
        {
          amount: 50000,
          created_at: '2026-09-30T09:00:00+00:00',
          description: 'balance',
          metadata: null,
        },
      ],
    });
  });

  it('throws when the order changed before dispatch', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'stale' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt',
        payment,
        taxSubtotals,
        transactions,
        merchant,
        null
      )
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the dispatch lease is lost', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'lease_lost' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt',
        payment,
        taxSubtotals,
        transactions,
        merchant,
        null
      )
    ).rejects.toThrow('Manual document dispatch lease lost');
  });

  it('throws for retry when the RPC fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt',
        payment,
        taxSubtotals,
        transactions,
        merchant,
        null
      )
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
