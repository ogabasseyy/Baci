import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const authenticateApiRequest = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest,
  getUserAccess: vi.fn(),
  hasPermission: vi.fn(),
}));

describe('POST /api/orders/:id/shipping/gigl-quote', () => {
  it('returns 401 before parsing an unauthenticated request', async () => {
    authenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Not authenticated',
    });
    const { POST } = await import('./route');
    const request = new NextRequest(
      'http://localhost/api/orders/o1/shipping/gigl-quote',
      { method: 'POST', body: '{not-json' }
    );
    const response = await POST(request, {
      params: Promise.resolve({ id: 'o1' }),
    });
    expect(response.status).toBe(401);
  });
});
