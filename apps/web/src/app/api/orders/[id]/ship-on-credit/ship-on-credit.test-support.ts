import { NextRequest } from 'next/server';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
}));

const {
  mockAuthenticateApiRequest,
  mockGetMerchantIdForApiUser,
  mockGeneratePaymentAccount,
  mockFrom,
  mockLogger,
  mockRpc,
  mockSupabaseClient,
  mockReconciliationInsert,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    mockAuthenticateApiRequest: vi.fn(),
    mockGetMerchantIdForApiUser: vi.fn(),
    mockGeneratePaymentAccount: vi.fn(),
    mockFrom,
    mockLogger,
    mockRpc: vi.fn(),
    mockSupabaseClient: {
      from: mockFrom,
      rpc: vi.fn(),
    },
    // handlePaymentForCancelledOrder files the reconciliation row through a
    // service-role admin client (reconciliation_review is RLS-locked to
    // service_role), not the route's own auth client.
    mockReconciliationInsert: vi
      .fn()
      .mockResolvedValue({ data: null, error: null }),
  };
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticateApiRequest,
  getMerchantIdForApiUser: mockGetMerchantIdForApiUser,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'reconciliation_review') {
        return { insert: mockReconciliationInsert };
      }
      throw new Error(`Unexpected admin table: ${table}`);
    }),
  })),
}));

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: mockGeneratePaymentAccount,
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

import { POST } from './route';

export function postShipOnCredit(...args: Parameters<typeof POST>) {
  return POST(...args);
}

export const ORDER_ID = 'order-123';
export const MERCHANT_ID = 'merchant-123';

export function createRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    `https://usebaci.com/api/orders/${ORDER_ID}/ship-on-credit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

export function createMalformedJsonRequest() {
  return new NextRequest(
    `https://usebaci.com/api/orders/${ORDER_ID}/ship-on-credit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }
  );
}

export function createParams() {
  return { params: Promise.resolve({ id: ORDER_ID }) };
}

export function createSelectSingleQuery<T>(data: T, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

export function createUpdateQuery(
  error: unknown = null,
  updatedOrder: Record<string, unknown> | null = {
    id: ORDER_ID,
    shipping_status: 'processing',
    cancelled_at: null,
  }
) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: updatedOrder, error }),
    error,
  };
}

export function createPaymentAccountTable(options: {
  insertError?: unknown;
  existingAccount?: {
    account_number: string;
    bank_name: string;
    account_name: string;
    assigned_at?: string | null;
    created_at?: string | null;
    expires_at?: string | null;
    provider?: string | null;
  } | null;
  existingAccountError?: unknown;
}) {
  mockRpc.mockResolvedValue({
    data: options.insertError ? null : 'inserted',
    error: options.insertError ?? null,
  });
  const selectQuery = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.existingAccount ?? null,
      error: options.existingAccountError ?? null,
    }),
  };

  return {
    insert: vi.fn().mockResolvedValue({ error: options.insertError ?? null }),
    select: vi.fn().mockReturnValue(selectQuery),
  };
}

export const shipOnCreditMocks = {
  mockAuthenticateApiRequest,
  mockFrom,
  mockGeneratePaymentAccount,
  mockGetMerchantIdForApiUser,
  mockLogger,
  mockRpc,
  mockReconciliationInsert,
  mockSupabaseClient,
};

export function resetShipOnCreditMocks() {
  vi.clearAllMocks();
  mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    user: { id: 'user-1' },
    supabase: mockSupabaseClient,
  });
  mockGetMerchantIdForApiUser.mockResolvedValue(MERCHANT_ID);
  mockSupabaseClient.rpc = mockRpc;
  mockRpc.mockResolvedValue({ data: 'inserted', error: null });
  mockGeneratePaymentAccount.mockResolvedValue({
    success: true,
    data: {
      account_number: '0123456789',
      bank_name: 'Wema Bank',
      account_name: 'Ogabassey / John Doe',
    },
  });
}
