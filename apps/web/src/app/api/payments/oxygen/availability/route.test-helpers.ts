import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';
import * as csrfModule from '@/lib/csrf';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';

const mocks = vi.hoisted(() => ({
  distributedRateLimit: vi.fn(),
  authenticateApiRequest: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.distributedRateLimit,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
}));

export type MerchantApiModule =
  typeof import('@/lib/get-merchant-for-api-request');

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...(await importOriginal<MerchantApiModule>()),
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
}));

// Synthetic fixtures only.
export const ORDER_ID = '123e4567-e89b-12d3-a456-426614174021';
export const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174022';
export const MERCHANT_B_ID = '123e4567-e89b-12d3-a456-426614174023';
export const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174024';
export const OTHER_CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174025';
export const SESSION_USER_ID = '123e4567-e89b-12d3-a456-426614174026';

export const ORDER_ROW = {
  id: ORDER_ID,
  merchant_id: MERCHANT_ID,
  customer_id: CUSTOMER_ID,
};

export function buildOwnerCtx(): MerchantContext {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: { full_access: { all: true } },
    },
  };
}

export function buildDeniedStaffCtx(): MerchantContext {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: {
      isStaff: true,
      isOwner: false,
      role: 'manager',
      permissions: {},
    },
  };
}

export interface WriteSpies {
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

export function buildSupabaseMock(args: {
  orderResult: { data: unknown; error: unknown };
  customerResult: { data: unknown; error: unknown };
}) {
  const throwing = (name: string) =>
    vi.fn(() => {
      throw new Error(`${name} must not be called`);
    });
  const writeSpies: WriteSpies = {
    insert: throwing('insert'),
    upsert: throwing('upsert'),
    update: throwing('update'),
    delete: throwing('delete'),
    rpc: throwing('rpc'),
  };
  const makeBuilder = (table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(() =>
        Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        )
      ),
      maybeSingle: vi.fn(() =>
        Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        )
      ),
      insert: writeSpies.insert,
      upsert: writeSpies.upsert,
      update: writeSpies.update,
      delete: writeSpies.delete,
    };
    return builder;
  };
  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: writeSpies.rpc,
    auth: {
      getUser: vi.fn(),
      admin: new Proxy(
        {},
        {
          get: () => {
            throw new Error('auth.admin must not be used');
          },
        }
      ),
    },
  };
  return { client, writeSpies };
}

export function expectNoWrites(writeSpies: WriteSpies) {
  expect(writeSpies.insert).not.toHaveBeenCalled();
  expect(writeSpies.upsert).not.toHaveBeenCalled();
  expect(writeSpies.update).not.toHaveBeenCalled();
  expect(writeSpies.delete).not.toHaveBeenCalled();
  expect(writeSpies.rpc).not.toHaveBeenCalled();
}

export function buildGetRequest(query: string, bearer = true): NextRequest {
  const headers: Record<string, string> = {};
  if (bearer) {
    headers.Authorization = 'Bearer test-token';
  }
  return new NextRequest(
    new URL(`availability${query}`, 'https://example.com/api/payments/oxygen/'),
    { method: 'GET', headers }
  );
}

export function buildPostRequest(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/payments/oxygen/attempts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
  });
}

export function mockAuthSuccess(client: unknown) {
  mocks.authenticateApiRequest.mockResolvedValue({
    user: { id: SESSION_USER_ID },
    error: null,
    supabase: client,
  });
}

export function mockProvenCustomer() {
  const supabase = buildSupabaseMock({
    orderResult: { data: ORDER_ROW, error: null },
    customerResult: { data: { id: CUSTOMER_ID }, error: null },
  });
  mockAuthSuccess(supabase.client);
  mocks.getMerchantForApiRequest.mockResolvedValue(null);
  return supabase;
}

export const csrfSpy = vi.spyOn(csrfModule, 'checkCsrfProtection');

export function getMocks() {
  return mocks;
}

const route = await import('./route');
const attemptsRoute = await import('../attempts/route');
export function GET(request: NextRequest) {
  return route.GET(request);
}
export function attemptsPOST(request: NextRequest) {
  return attemptsRoute.POST(request);
}
