import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidUuid } from '@/lib/sanitize-core';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn() }));
vi.mock('@/lib/sanitize-core', () => ({
  isValidUuid: vi.fn(),
  sanitizeForLog: vi.fn((value) => value),
}));

import { GET } from './route';
import {
  mockSupabaseClient,
  resetStorefrontOrderMocks,
} from './route.test-support';

describe('GET /api/storefront/orders/[id] request handling', () => {
  beforeEach(resetStorefrontOrderMocks);

  it('returns 400 for invalid email format', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-123?email=invalid-email&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-123' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid request');
  });

  it('returns 400 for an invalid UUID when authenticated without a token', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/not-a-uuid'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });
    vi.mocked(isValidUuid).mockReturnValue(false);

    const response = await GET(request, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid order ID');
  });

  it('returns 500 on unexpected authentication errors', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockRejectedValue(
      new Error('Unexpected error')
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Internal server error');
  });
});
