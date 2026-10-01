import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

export function createStorefrontDocumentSupabaseMock(options?: {
  canCancelResult?: { data: unknown; error: unknown };
  orderPatch?: Record<string, unknown>;
  paymentAccounts?: unknown[];
  transactions?: unknown[];
}) {
  type QueryResult = { data: unknown; error: unknown };
  const rpc = vi.fn((fn: string) => {
    if (fn === 'customer_order_can_cancel') {
      return Promise.resolve(
        options?.canCancelResult ?? { data: true, error: null }
      );
    }
    if (fn === 'get_customer_order_transactions') {
      return Promise.resolve({
        data: (options?.transactions ?? []).map((transaction) => ({
          amount: (transaction as { amount?: unknown }).amount ?? null,
          created_at:
            (transaction as { created_at?: unknown }).created_at ??
            '2026-03-22T10:00:00.000Z',
          description:
            (transaction as { description?: unknown }).description ?? null,
          dva_account_number:
            (transaction as { metadata?: { dva_account_number?: unknown } })
              .metadata?.dva_account_number ?? null,
          gateway: (transaction as { gateway?: unknown }).gateway ?? null,
          id: (transaction as { id?: unknown }).id ?? null,
          order_id: 'order-1',
          status: (transaction as { status?: unknown }).status ?? null,
          transaction_type:
            (transaction as { transaction_type?: unknown }).transaction_type ??
            null,
        })),
        error: null,
      });
    }
    if (fn === 'get_customer_order_payment_accounts') {
      return Promise.resolve({
        data: options?.paymentAccounts ?? [],
        error: null,
      });
    }
    return Promise.reject(new Error(`Unexpected rpc: ${fn}`));
  });
  function tableQuery(result: QueryResult) {
    const query = Object.assign(Promise.resolve(result), {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
    });
    return query;
  }
  const order = {
    id: 'order-1',
    order_number: 'ORD-1001',
    created_at: '2026-03-22T10:00:00.000Z',
    updated_at: null,
    payment_status: 'unpaid',
    shipping_status: 'processing',
    currency: 'NGN',
    total: 100000,
    subtotal: 100000,
    shipping_fee: 0,
    tax_amount: 0,
    discount_amount: 0,
    amount_paid: 0,
    shipping_address: null,
    customer_name: null,
    customer_email: null,
    customer_phone: null,
    payment_method: 'bank_transfer',
    is_credit_order: false,
    tracking_number: null,
    shipping_provider: null,
    notes: null,
    invoice_type_code: '380',
    invoice_issue_date: null,
    tax_point_date: null,
    payment_due_date: null,
    buyer_reference: null,
    purchase_order_reference: null,
    tax_exclusive_amount: 100000,
    tax_inclusive_amount: 100000,
    invoice_note: null,
    firs_irn: null,
    firs_csid: null,
    firs_qr_code: null,
    payment_terms: null,
  };
  const supabase = {
    rpc,
    from(table: string) {
      switch (table) {
        case 'merchants':
          return tableQuery({
            data: {
              business_name: 'Ogabassey',
              logo_url: null,
              email: null,
              phone: null,
              support_email: null,
              support_phone: null,
              business_address: null,
              cac_rc_number: null,
              tax_identification_number: null,
              legal_entity_name: null,
              brand_colors: null,
              vat_registration_status: 'unregistered',
              vat_rate: 0,
              bank_code: null,
              bank_account_number: null,
              bank_name: null,
              bank_account_name: null,
              social_media: null,
              pages: null,
              registered_address: null,
              id: 'merchant-1',
              slug: 'ogabassey',
            },
            error: null,
          });
        case 'customers':
          return tableQuery({ data: { id: 'customer-1' }, error: null });
        case 'orders':
          return tableQuery({
            data: { ...order, ...options?.orderPatch },
            error: null,
          });
        case 'order_items':
        case 'order_tax_subtotals':
          return tableQuery({ data: [], error: null });
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    },
  } as unknown as SupabaseClient & { rpc: typeof rpc };
  return { supabase, rpc };
}
