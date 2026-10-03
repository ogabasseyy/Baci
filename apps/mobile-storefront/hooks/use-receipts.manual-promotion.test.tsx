import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';

type QueryOptions = {
  enabled?: boolean;
  queryFn: () => Promise<unknown>;
};

type SupabaseListResponse = {
  data: unknown[] | null;
  error: Error | null;
};

type SupabaseSingleResponse = {
  data: unknown;
  error: Error | null;
};

type MockAuthState = {
  merchantId: string | null;
  user: { id: string } | null;
};

const mockUseQuery = jest.fn((options: unknown) => options);
const mockWithSupabaseRetry = jest.fn(
  async (callback: () => Promise<unknown>) => callback()
);
const mockAuthState: MockAuthState = {
  merchantId: 'merchant-1',
  user: { id: 'auth-user-1' },
};
const mockOrder = jest.fn<() => Promise<SupabaseListResponse>>();
const mockSingle = jest.fn<() => Promise<SupabaseSingleResponse>>();
const mockLimit = jest.fn<() => Promise<SupabaseListResponse>>();
const mockQueryBuilder = {
  eq: jest.fn((_field: string, _value: string) => mockQueryBuilder),
  limit: mockLimit,
  order: mockOrder,
  select: jest.fn((_columns: string) => mockQueryBuilder),
  single: mockSingle,
};
const mockFrom = jest.fn((_table: string) => mockQueryBuilder);
// fetchReceiptDetail also reads payment-account/transaction RPCs; resolve them
// as empty so detail-prefetch tests exercise the query scoping, not the RPCs.
const mockRpc = jest.fn((_fn: string, _args: unknown) => ({}));
const mockUseAuthStore = Object.assign(
  jest.fn((selector: (state: MockAuthState) => unknown) =>
    selector(mockAuthState)
  ),
  {
    getState: jest.fn(() => mockAuthState),
  }
);

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}));

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (callback: () => Promise<unknown>) =>
    mockWithSupabaseRetry(callback),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: mockUseAuthStore,
}));

describe('useReceipts manual promotion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.mockReset();
    mockAuthState.merchantId = 'merchant-1';
    mockAuthState.user = { id: 'auth-user-1' };
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockOrder.mockImplementationOnce(() => mockQueryBuilder as never);
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockResolvedValue({ data: [], error: null });
  });

  it('projects the promoted kind for covered manual balances', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          shipping_status: 'processing',
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-1', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
        {
          id: 'order-2',
          order_number: 'ORD-2',
          payment_status: 'pending',
          shipping_status: 'processing',
          recorded_by_user_id: null,
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 0,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-2', name: 'Cable', quantity: 1, price: 500 },
          ],
        },
      ],
      error: null,
    });

    function Probe() {
      useReceipts('auth-user-1');
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;
    const receipts = (await options.queryFn()) as Array<{
      document_kind: string;
    }>;

    // The covered manual row opens a receipt in the preview, so the list
    // must badge it receipt — never "View Invoice" into a receipt.
    expect(receipts.map((row) => row.document_kind)).toEqual([
      'receipt',
      'invoice',
    ]);
  });

  it('routes paid manual rows through the promotion gate, not the paid shortcut', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'order-paid-manual-valid',
          order_number: 'ORD-11',
          payment_status: 'paid',
          shipping_status: 'processing',
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-1', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
        {
          id: 'order-paid-manual-cancelled',
          order_number: 'ORD-12',
          payment_status: 'paid',
          shipping_status: 'cancelled',
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-2', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
        {
          id: 'order-paid-standard',
          order_number: 'ORD-13',
          payment_status: 'paid',
          shipping_status: 'delivered',
          recorded_by_user_id: null,
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-3', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
      ],
      error: null,
    });

    function Probe() {
      useReceipts('auth-user-1');
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;
    const receipts = (await options.queryFn()) as Array<{
      id: string;
      document_kind: string;
    }>;

    // The preview excludes manual rows from the generic paid shortcut, so
    // the cancelled paid-manual row must badge invoice here too — never
    // "View Receipt" into an invoice.
    expect(receipts.map((row) => [row.id, row.document_kind])).toEqual([
      ['order-paid-manual-valid', 'receipt'],
      ['order-paid-manual-cancelled', 'invoice'],
      ['order-paid-standard', 'receipt'],
    ]);
    // The gate evaluates item financial fields, so the list must select
    // them like the detail query does.
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('vat_amount')
    );
  });
});
