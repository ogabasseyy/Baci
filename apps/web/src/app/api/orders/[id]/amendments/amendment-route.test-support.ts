import type { NextRequest } from 'next/server';
import { beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  logError: vi.fn(),
  rateLimit: vi.fn(),
  rpc: vi.fn(),
}));

export { mocks };

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.logError } }));
vi.mock('@/lib/rate-limiter', () => ({ checkRateLimit: mocks.rateLimit }));

export const id = '11111111-1111-4111-8111-111111111111';
export const replacementId = '22222222-2222-4222-8222-222222222222';
export const amendmentId = '33333333-3333-4333-8333-333333333333';
export const context = { params: Promise.resolve({ id }) };
export function request(body?: unknown) {
  return new Request('https://test.invalid/api/orders/amendments', {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: body === undefined ? 'GET' : 'POST',
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id } });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { amendmentId: id }, error: null });
});
