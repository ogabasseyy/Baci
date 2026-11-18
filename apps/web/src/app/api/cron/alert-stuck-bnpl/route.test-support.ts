import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getCronSecret: vi.fn<() => string | undefined>(() => 'cron-secret'),
  limit: vi.fn(),
  statusIn: vi.fn(),
  lt: vi.fn(),
  gte: vi.fn(),
  statusOr: vi.fn(),
  transactionsIn: vi.fn(),
  reviewInsert: vi.fn(),
  notifyMerchant: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/env', () => ({
  getCronSecret: mocks.getCronSecret,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    mocks.createAdminClient();
    const ordersChain = {
      select: vi.fn(),
      eq: vi.fn(),
      in: mocks.statusIn,
      lt: mocks.lt,
      gte: mocks.gte,
      or: mocks.statusOr,
      order: vi.fn(),
      limit: mocks.limit,
    };
    ordersChain.select.mockReturnValue(ordersChain);
    ordersChain.eq.mockReturnValue(ordersChain);
    mocks.statusIn.mockReturnValue(ordersChain);
    mocks.lt.mockReturnValue(ordersChain);
    mocks.gte.mockReturnValue(ordersChain);
    mocks.statusOr.mockReturnValue(ordersChain);
    ordersChain.order.mockReturnValue(ordersChain);

    const transactionsChain = {
      select: vi.fn(),
      in: mocks.transactionsIn,
    };
    transactionsChain.select.mockReturnValue(transactionsChain);

    const reconciliationReviewChain = {
      insert: mocks.reviewInsert,
    };

    return {
      from: vi.fn((table: string) => {
        if (table === 'transactions') return transactionsChain;
        if (table === 'reconciliation_review') {
          return reconciliationReviewChain;
        }
        return ordersChain;
      }),
    };
  },
}));

vi.mock('@/lib/expo-push', () => ({
  notifyMerchant: (...args: unknown[]) => mocks.notifyMerchant(...args),
  formatCurrency: (amount: number) => `₦${amount.toLocaleString()}`,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mocks.loggerWarn(...args),
    error: (...args: unknown[]) => mocks.loggerError(...args),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

export function createCronRequest(auth: string | null = 'Bearer cron-secret') {
  return new NextRequest('http://localhost:3000/api/cron/alert-stuck-bnpl', {
    headers: auth ? { authorization: auth } : {},
    method: 'GET',
  });
}

export function stuckOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    merchant_id: 'merchant-1',
    total: 100000,
    payment_method: 'credit_direct',
    payment_status: 'bnpl_pending',
    updated_at: '2026-07-01T00:00:00.000Z',
    notes:
      '{"credit_directTransactionId":"txn-1","creditDirectClientCompletedTransactionId":"txn-1","creditDirectClientCompletedAt":"2026-07-01T00:01:00.000Z"}',
    ...overrides,
  };
}

export function resetCronMocks() {
  vi.clearAllMocks();
  mocks.getCronSecret.mockReturnValue('cron-secret');
  mocks.notifyMerchant.mockResolvedValue({ sent: 1, failed: 0, errors: [] });
  mocks.limit.mockResolvedValue({ data: [], error: null });
  mocks.transactionsIn.mockResolvedValue({ data: [], error: null });
  mocks.reviewInsert.mockResolvedValue({ error: null });
}

export async function runCron(request: NextRequest) {
  const { GET } = await import('./route');
  return GET(request);
}

export { mocks };
