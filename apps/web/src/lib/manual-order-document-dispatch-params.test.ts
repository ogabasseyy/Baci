import { describe, expect, it } from 'vitest';
import {
  buildDispatchRpcParams,
  type DispatchRpcParamsInput,
} from './manual-order-document-dispatch-params';
import {
  merchant,
  order,
  payment,
  row,
  taxSubtotals,
  transactions,
} from './mark-manual-document-dispatch-started.test-fixture';

const baseInput: DispatchRpcParamsInput = {
  row,
  order,
  documentKind: 'receipt',
  payment,
  taxSubtotals,
  transactions,
  merchant,
  claimDomain: 'shop.example.com',
};

describe('buildDispatchRpcParams', () => {
  it('maps every rendered field to the atomic dispatch RPC', () => {
    const params = buildDispatchRpcParams(baseInput);

    // A missing, renamed, or extra parameter breaks the positional RPC
    // contract (stale-everything or stale-nothing), so pin the key set.
    expect(Object.keys(params).sort()).toEqual(
      [
        'p_amount_paid',
        'p_buyer_reference',
        'p_claim_domain',
        'p_claim_owner',
        'p_currency',
        'p_customer_email',
        'p_customer_id',
        'p_customer_name',
        'p_customer_phone',
        'p_discount_amount',
        'p_document_kind',
        'p_external_source',
        'p_firs_csid',
        'p_firs_irn',
        'p_import_job_id',
        'p_invoice_issue_date',
        'p_invoice_note',
        'p_invoice_type_code',
        'p_item_count',
        'p_items',
        'p_merchant_bank_account_name',
        'p_merchant_bank_account_number',
        'p_merchant_bank_code',
        'p_merchant_bank_name',
        'p_merchant_brand_colors',
        'p_merchant_business_address',
        'p_merchant_business_name',
        'p_merchant_cac_rc_number',
        'p_merchant_email_sender_name',
        'p_merchant_legal_entity_name',
        'p_merchant_logo_url',
        'p_merchant_phone',
        'p_merchant_registered_address',
        'p_merchant_slug',
        'p_merchant_support_email',
        'p_merchant_support_phone',
        'p_merchant_tax_identification_number',
        'p_merchant_vat_rate',
        'p_merchant_vat_registration_status',
        'p_notes',
        'p_order_created_at',
        'p_order_number',
        'p_outbox_id',
        'p_payment_due_date',
        'p_payment_method',
        'p_payment_status',
        'p_payment_terms',
        'p_recorded_by_user_id',
        'p_shipping_address',
        'p_shipping_fee',
        'p_shipping_status',
        'p_subtotal',
        'p_tax_amount',
        'p_tax_count',
        'p_tax_subtotals',
        'p_total',
        'p_transaction_date',
        'p_transactions',
        'p_txn_count',
        'p_va_account_name',
        'p_va_bank_name',
        'p_va_account_number',
      ].sort()
    );
    expect(params.p_payment_due_date).toBe('2026-10-15');
    expect(params.p_payment_terms).toBe('Net 30');
    expect(params.p_buyer_reference).toBe('BUYER-1');
    expect(params.p_firs_irn).toBe('IRN-1');
    expect(params.p_firs_csid).toBe('CSID-1');
    // Tax rows sort canonically by id and drop the row id, matching the
    // server's ORDER BY aggregation.
    expect(params.p_tax_count).toBe(2);
    expect(params.p_tax_subtotals).toEqual([
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
    ]);
    // Transaction metadata narrows to the rendered payment_method key so
    // webhook enrichments cannot stale the comparison.
    expect(params.p_txn_count).toBe(2);
    expect(params.p_transactions).toEqual([
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
        metadata: { payment_method: null },
      },
    ]);
  });

  it('normalizes missing optionals to null for the RPC comparison', () => {
    const params = buildDispatchRpcParams({
      ...baseInput,
      order: {
        ...order,
        currency: undefined,
        invoice_note: undefined,
        payment_due_date: undefined,
        payment_terms: undefined,
        buyer_reference: undefined,
        firs_irn: undefined,
        firs_csid: undefined,
        notes: undefined,
      },
      transactions: [
        {
          id: 'txn-9',
          amount: 10,
          created_at: '2026-09-30T09:00:00+00:00',
          description: null,
          metadata: { payment_method: 7 },
        },
      ],
    });

    // undefined would drop the key on the wire; SQL null is distinct from
    // a missing comparison, so every optional normalizes to null.
    expect(params.p_currency).toBeNull();
    expect(params.p_invoice_note).toBeNull();
    expect(params.p_payment_due_date).toBeNull();
    expect(params.p_payment_terms).toBeNull();
    expect(params.p_buyer_reference).toBeNull();
    expect(params.p_firs_irn).toBeNull();
    expect(params.p_firs_csid).toBeNull();
    expect(params.p_notes).toBeNull();
    // Non-string metadata values stringify to match the server ->> text.
    expect(params.p_transactions).toEqual([
      {
        amount: 10,
        created_at: '2026-09-30T09:00:00+00:00',
        description: null,
        metadata: { payment_method: '7' },
      },
    ]);
  });

  it('snapshots structured methods as absent like the server builder', () => {
    const params = buildDispatchRpcParams({
      ...baseInput,
      transactions: [
        {
          id: 'txn-9',
          amount: 10,
          created_at: '2026-09-30T09:00:00+00:00',
          description: 'object',
          metadata: { payment_method: { name: 'cash' } },
        },
        {
          id: 'txn-10',
          amount: 10,
          created_at: '2026-09-30T09:00:00+00:00',
          description: 'array',
          metadata: { payment_method: ['cash'] },
        },
      ],
    });

    // String() would emit '[object Object]' while SQL ->> emits JSON
    // text: both sides snapshot null so the comparison never stales.
    expect(params.p_transactions).toEqual([
      {
        amount: 10,
        created_at: '2026-09-30T09:00:00+00:00',
        description: 'array',
        metadata: { payment_method: null },
      },
      {
        amount: 10,
        created_at: '2026-09-30T09:00:00+00:00',
        description: 'object',
        metadata: { payment_method: null },
      },
    ]);
  });
});
