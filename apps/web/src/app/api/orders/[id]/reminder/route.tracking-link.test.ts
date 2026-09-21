// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mockCheckCsrfProtection = vi.fn();
const mockSendEmail = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  getMerchantIdForApiUser: vi.fn(),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

type QueryResult = { data: unknown; error: null };

function singleChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function listChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => Promise.resolve(result));
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason?: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const merchantRow = {
  id: 'merchant-1',
  business_name: 'Baci Store',
  slug: 'baci-store',
  support_email: 'support@example.com',
  email_sender_name: null,
  tax_identification_number: null,
  cac_rc_number: null,
};

const orderRow: Record<string, unknown> & { tracking_token: string | null } = {
  id: 'order-1',
  order_number: 'ORD-1',
  total: 50000,
  amount_paid: 0,
  customer_id: 'customer-1',
  customer_name: 'Ada Lovelace',
  customer_email: 'ada@example.com',
  customer_phone: '08000000000',
  payment_status: 'pending',
  currency: 'NGN',
  tracking_token: 'track-token-abc',
};

const selectColumnsByTable: Record<string, string[]> = {};

function setupSupabase(order: typeof orderRow) {
  for (const key of Object.keys(selectColumnsByTable)) {
    delete selectColumnsByTable[key];
  }
  mockFrom.mockImplementation((table: string) => {
    if (table === 'merchants') {
      return {
        select: vi.fn((columns: string) => {
          selectColumnsByTable.merchants = [columns];
          return singleChain({ data: merchantRow, error: null });
        }),
      };
    }
    if (table === 'orders') {
      return {
        select: vi.fn((columns: string) => {
          selectColumnsByTable.orders = [columns];
          return singleChain({ data: order, error: null });
        }),
      };
    }
    if (table === 'order_items') {
      return {
        select: vi.fn(() =>
          listChain({
            data: [{ product_name: 'Widget', quantity: 1, price: 50000 }],
            error: null,
          })
        ),
      };
    }
    if (table === 'order_payment_accounts') {
      return { select: vi.fn(() => listChain({ data: [], error: null })) };
    }
    if (table === 'order_reminders') {
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

async function setupAuth() {
  const apiAuth = await import('@/lib/api-auth');
  vi.mocked(apiAuth.authenticateApiRequest).mockResolvedValue({
    user: { id: 'user-1' },
    error: null,
    supabase: { from: mockFrom },
  } as never);
  vi.mocked(apiAuth.getMerchantIdForApiUser).mockResolvedValue('merchant-1');
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/orders/order-1/reminder', {
    method: 'POST',
    body: JSON.stringify({ channel: 'email' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/orders/[id]/reminder tracking link', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockSendEmail.mockResolvedValue(undefined);
    setupSupabase(orderRow);
    await setupAuth();
  });

  it('links the reminder to the tracking-token URL without customer PII', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'order-1' }),
    });
    const body = (await response.json()) as { paymentLink: string };

    expect(response.status).toBe(200);
    expect(selectColumnsByTable.orders?.[0]).toContain('tracking_token');
    expect(body.paymentLink).toBe(
      'https://baci-store.usebaci.com/track-order?token=track-token-abc'
    );
    expect(body.paymentLink).not.toContain('ada@example.com');
    expect(body.paymentLink).not.toContain('order_id=');
  });

  it('falls back to the order id plus email pair when no token exists', async () => {
    setupSupabase({ ...orderRow, tracking_token: null });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'order-1' }),
    });
    const body = (await response.json()) as { paymentLink: string };

    expect(response.status).toBe(200);
    expect(body.paymentLink).toContain('order_id=order-1');
    expect(body.paymentLink).toContain('email=ada%40example.com');
  });
});
