// Shared test fixtures for `reconcile-paystack-dva.test.ts` and
// related test files. Extracted so each test module stays under the
// 300-line per-file cap.
//
// Test-only — never imported by production code. Filename includes the
// `.test-fixtures` suffix to keep it out of the production bundle.

import { vi } from 'vitest';

// Pinned operational identifiers from the 2026-05-09 recovery (UUIDs +
// Paystack ref). Customer identifiers below are synthetic — see
// CLAUDE.md "data-minimization" + git-history hygiene. The actual
// recovery command lives in the PR description and ops runbook, not
// in source.
export const efosaArgs = [
  '--transaction-id',
  '427ec4ea-b41d-4058-aaf9-3de57ee5fa35',
  '--paystack-reference',
  '100026260509110323000058369193',
  '--canonical-order-id',
  '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
  '--cancel-orders',
  '9235a8d5-55fc-4e90-8238-4bb6698679bd,de838a51-d0e9-4438-9f55-135b7677783f,a259300d-aef4-44f2-9506-22b47fab756d',
  '--operator-user-id',
  '11111111-1111-4111-8111-111111111111',
];

export const verifySuccess = {
  success: true as const,
  data: {
    id: 1,
    status: 'success' as const,
    reference: '100026260509110323000058369193',
    amount: 83_500_000, // ₦835,000 in kobo
    currency: 'NGN',
    channel: 'dedicated_nuban',
    paid_at: '2026-05-09T11:03:00Z',
    created_at: '2026-05-09T11:00:00Z',
    customer: {
      customer_code: 'CUS_X',
      email: 'test-customer@example.com',
      first_name: 'Test',
      id: 1,
      last_name: 'Customer',
      phone: null,
    },
    metadata: null,
    authorization: null,
    fees: 300_000,
    fees_split: null,
  },
};

const defaultRpcResult = {
  data: {
    canonical_order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
    reconciled_at: '2026-05-10T18:00:00Z',
    already_completed: false,
    order_already_paid: false,
    txn_rows_updated: 1,
    order_rows_updated: 1,
    dup_orders_cancelled: 3,
    dup_txns_cancelled: 3,
  },
  error: null,
};

const defaultTxn = {
  id: '427ec4ea-b41d-4058-aaf9-3de57ee5fa35',
  order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
  merchant_id: 'merchant-1',
  gateway_reference: 'BAC-7TUD6N4WJCNM',
  amount: 835_000,
  metadata: {},
};

const defaultOrder = {
  id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
  merchant_id: 'merchant-1',
  payment_status: 'paid',
  tax_basis: null, // The incident order's actual prod state (Δ-31)
  subtotal: 810_000,
  shipping_fee: 25_000,
  gift_wrapping_fee: 0,
  tax_amount: 60_750,
  discount_amount: 0,
  total: 835_000,
  order_number: 'ORD-260509-00NV-R',
  customer_id: 'customer-1',
  customer_name: 'Test Customer',
  customer_email: 'test-customer@example.com',
  customer_phone: '+2348000000000',
  currency: 'NGN',
  shipping_address: { address: '1 Test St', city: 'Lagos', state: 'Lagos' },
  order_items: [],
};

const defaultMerchant = {
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  support_email: 'support@ogabassey.com',
  email_sender_name: 'Ogabassey',
  email: 'support@ogabassey.com',
  tax_identification_number: null,
  cac_rc_number: null,
};

export function createSupabaseMock(opts: {
  rpcResult?: { data: unknown; error: unknown };
  txn?: Record<string, unknown> | null;
  order?: Record<string, unknown> | null;
  merchant?: Record<string, unknown> | null;
}) {
  const rpcResult = opts.rpcResult ?? defaultRpcResult;
  const txn = opts.txn ?? defaultTxn;
  const order = opts.order ?? defaultOrder;
  const merchant = opts.merchant ?? defaultMerchant;

  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const from = vi.fn((table: string) => {
    if (table === 'transactions') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: txn, error: null }),
          }),
        }),
      };
    }
    if (table === 'orders') {
      const filters: Array<[string, unknown]> = [];
      const query: {
        eq: ReturnType<typeof vi.fn>;
        single: ReturnType<typeof vi.fn>;
      } = {
        eq: vi.fn(),
        single: vi.fn(),
      };
      query.eq.mockImplementation((column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      });
      query.single.mockImplementation(async () => ({
        data: filters.every(([column, value]) => order?.[column] === value)
          ? order
          : null,
        error: null,
      }));
      return {
        select: vi.fn().mockReturnValue(query),
      };
    }
    if (table === 'merchants') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: merchant, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unmocked table: ${table}`);
  });

  return { supabase: { rpc, from }, rpc, from };
}
