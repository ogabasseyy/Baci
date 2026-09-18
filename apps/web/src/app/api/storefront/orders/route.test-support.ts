import type { SupabaseClient, User } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

interface QueryResult<TData> {
  data: TData | null;
  error: { message: string } | null;
}

interface OrderPaymentAccountFixture {
  account_number: string;
  bank_name: string | null;
  account_name: string | null;
  provider?: string | null;
  assignment_customer_email_source?: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  expires_at?: string | null;
}

interface OrderTransactionFixture {
  order_id: string;
  created_at: string | null;
  metadata: unknown;
  gateway?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

function createSingleQuery<TData>(result: QueryResult<TData>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

function createOrdersQuery<TData>(result: QueryResult<TData>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockImplementationOnce(() => query).mockResolvedValue(result);
  return query;
}

function createTransactionsQuery<TData>(result: QueryResult<TData>) {
  const query = {
    select: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockResolvedValue(result);
  return query;
}

export function createSupabaseMock(input?: {
  merchant?: QueryResult<{ id: string } | null>;
  customer?: QueryResult<{ id: string } | null>;
  orders?: QueryResult<
    Array<{
      id: string;
      order_number: string;
      created_at: string;
      transaction_date?: string | null;
      total: number;
      subtotal: number;
      shipping_fee: number;
      tax_amount: number;
      discount_amount: number;
      amount_paid: number;
      currency: string;
      external_source?: string | null;
      import_job_id?: string | null;
      payment_status: string;
      shipping_status: string;
      shipping_address: Record<string, unknown> | null;
      tracking_number: string | null;
      shipping_provider: string | null;
      payment_method: string | null;
      fulfillment_details?: {
        imei?: string | null;
        serialNumber?: string | null;
        serial_number?: string | null;
      } | null;
      order_payment_accounts?: OrderPaymentAccountFixture[];
      order_items: Array<{
        id: string;
        product_id: string;
        image_url?: string | null;
        condition?: string | null;
        variant_name?: string | null;
        name: string;
        quantity: number;
        price: number;
        has_assurance: boolean | null;
        products?: {
          slug?: string;
          category?: string | null;
          category_slug?: string | null;
          images?: string[] | null;
          categories?: { name?: string; slug?: string }[] | null;
        } | null;
      }>;
    }>
  >;
  transactions?: QueryResult<OrderTransactionFixture[]>;
  paymentAccounts?: QueryResult<OrderPaymentAccountFixture[]>;
}) {
  const merchantQuery = createSingleQuery(
    input?.merchant ?? {
      data: { id: 'merchant-1' },
      error: null,
    }
  );
  const customerQuery = createSingleQuery(
    input?.customer ?? {
      data: { id: 'customer-1' },
      error: null,
    }
  );
  const ordersQuery = createOrdersQuery(
    input?.orders ?? {
      data: [],
      error: null,
    }
  );
  const transactionsQuery = createTransactionsQuery(
    input?.transactions ?? { data: [], error: null }
  );
  const rpc = vi.fn((fn: string) => {
    if (fn === 'get_customer_order_transactions') {
      return Promise.resolve({
        data: (input?.transactions?.data ?? []).map((transaction) => ({
          ...transaction,
          dva_account_number:
            (transaction.metadata as { dva_account_number?: unknown } | null)
              ?.dva_account_number ?? null,
        })),
        error: input?.transactions?.error ?? null,
      });
    }
    if (fn === 'get_customer_order_payment_accounts') {
      const accounts = (input?.orders?.data ?? []).flatMap((order) =>
        (order.order_payment_accounts ?? []).map((account) => ({
          ...account,
          order_id: order.id,
        }))
      );
      return Promise.resolve(
        input?.paymentAccounts ?? { data: accounts, error: null }
      );
    }
    return Promise.reject(new Error(`Unexpected rpc: ${fn}`));
  });

  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return merchantQuery;
      }

      if (table === 'customers') {
        return customerQuery;
      }

      if (table === 'orders') {
        return ordersQuery;
      }

      if (table === 'transactions') {
        return transactionsQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

export function createAuthenticatedAuthResult(
  supabase: SupabaseClient
): AuthResult {
  return {
    user: { id: 'user-1' } as User,
    error: null,
    supabase,
  };
}
