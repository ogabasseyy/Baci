// Shared mocks for the loyalty redemption-consume suites: registers
// the auth/CSRF/merchant mocks and re-exports POST (same pattern as
// route.test-support.ts in the discount-validate suites).
import { NextRequest } from 'next/server';
import { vi } from 'vitest';

export const MOBILE_AUTH_TOKEN = ['mobile', 'test', 'token'].join('-');

const checkCsrfProtection = vi.fn();
const authenticateApiRequest = vi.fn();
const getBearerTokenFromRequest = vi.fn();
const hasPermission = vi.fn();
const getMerchantForApiRequest = vi.fn();
const toUserAccess = vi.fn((context: { role?: string }) => ({
  role: context.role ?? 'owner',
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest,
  getBearerTokenFromRequest,
  hasPermission,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest,
  toUserAccess,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => createMockSupabase()),
}));

export const { POST } = await import('./route');

export { authenticateApiRequest, checkCsrfProtection, hasPermission };

let authUser: { id: string } | null = { id: 'user-1' };
let merchantContext: { merchantId: string; role?: string } | null = {
  merchantId: 'merchant-1',
  role: 'owner',
};
let rpcResult: Record<string, unknown> = {};
let rpcError: { message: string } | null = null;
let csrfValid = true;

export const rpc = vi.fn(() =>
  Promise.resolve({
    data: rpcError ? null : rpcResult,
    error: rpcError,
  })
);

const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: 'Not authenticated' },
      })
    ),
  },
  rpc,
});

export function setAuthUser(user: { id: string } | null) {
  authUser = user;
}

export function setRpcResult(result: Record<string, unknown>) {
  rpcResult = result;
}

export function setRpcError(error: { message: string } | null) {
  rpcError = error;
}

export function setCsrfValid(valid: boolean) {
  csrfValid = valid;
}

export function setHasPermission(allowed: boolean) {
  hasPermission.mockReturnValue(allowed);
}

export function setupConsumeMocks() {
  vi.clearAllMocks();
  csrfValid = true;
  checkCsrfProtection.mockImplementation(() =>
    Promise.resolve({
      valid: csrfValid,
      response: csrfValid
        ? null
        : new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
            status: 403,
          }),
    })
  );
  authUser = { id: 'user-1' };
  merchantContext = { merchantId: 'merchant-1', role: 'owner' };
  rpcResult = {
    success: true,
    redemption_id: 'redemption-1',
    discount_code: 'RDM-ABC123',
    reward_type: 'free_product',
    reward_id: 'reward-1',
    reward_name: 'Free mug',
    reward_product_id: 'product-1',
    customer_id: 'customer-1',
    used_at: '2026-10-13T00:00:00.000Z',
  };
  rpcError = null;
  hasPermission.mockReturnValue(true);
  getMerchantForApiRequest.mockResolvedValue(merchantContext);
  // Mirrors the real helper: a bare `Bearer` scheme word without a
  // token extracts nothing, so authentication falls back to cookies.
  getBearerTokenFromRequest.mockImplementation((request: Request) => {
    const match = (request.headers.get('authorization') ?? '').match(
      /^\s*bearer\s+(.+?)\s*$/i
    );
    return match?.[1]?.trim() || null;
  });
  authenticateApiRequest.mockImplementation((request: Request) => {
    // Branch on token extraction exactly like production: a tokenless
    // scheme word (bare `Bearer`, trailing space, tab) extracts null
    // and falls back to cookie auth instead of failing as Bearer [REDACTED]
    const token = getBearerTokenFromRequest(request);
    if (token !== null) {
      return Promise.resolve(
        token === MOBILE_AUTH_TOKEN
          ? { user: { id: 'mobile-user' }, supabase: createMockSupabase() }
          : { user: null, supabase: null }
      );
    }
    return Promise.resolve({
      user: authUser,
      supabase: createMockSupabase(),
    });
  });
}

export function makeRequest(
  body?: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return new NextRequest(
    'http://localhost:3000/api/loyalty/redemptions/consume',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }
  );
}
