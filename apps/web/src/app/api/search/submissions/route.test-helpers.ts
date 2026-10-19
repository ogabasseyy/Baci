import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merchant: vi.fn(),
  rpc: vi.fn(),
  cookieInsert: vi.fn(),
  cookieFrom: vi.fn(),
  recordSubmission: vi.fn(),
}));
// Hoisted bindings cannot be exported; alias for test assertions.
export const submissionMocks = mocks;
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: mocks.merchant,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.cookieFrom }),
}));
vi.mock('@/lib/search/server-analytics-client', () => ({
  recordSearchSubmission: mocks.recordSubmission,
  // Same class object the route's instanceof checks: mirror the real
  // module's brand (message + name) without importing server-only code.
  SearchSubmissionValidationError: class SearchSubmissionValidationError extends Error {
    constructor() {
      super('Invalid search submission row');
      this.name = 'SearchSubmissionValidationError';
    }
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

// Import the handler AFTER mocks so the route binds the mocked modules.
export const { POST } = await import('./route');
export const { logger } = await import('@/lib/logger');
export const { SearchSubmissionValidationError } = await import(
  '@/lib/search/server-analytics-client'
);

export const merchantId = '123e4567-e89b-12d3-a456-426614174000';

export function request(
  body: unknown = { query: ' iphone ', pathPrefix: '', source: 'navbar' },
  headers: Record<string, string> = {},
  url = 'https://ogabassey.com/api/search/submissions'
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      origin: new URL(url).origin,
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function setupSubmissionMocks() {
  mocks.merchant.mockResolvedValue({ id: merchantId, slug: 'ogabassey' });
  mocks.rpc.mockResolvedValue({
    data: [{ product_id: 'phone-1', total_count: 27 }],
    error: null,
  });
  mocks.cookieInsert.mockResolvedValue({ error: null });
  mocks.cookieFrom.mockReturnValue({ insert: mocks.cookieInsert });
  mocks.recordSubmission.mockResolvedValue({ error: null });
}
