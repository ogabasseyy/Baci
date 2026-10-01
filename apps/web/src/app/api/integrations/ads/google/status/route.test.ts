import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockQuery = {
  eq: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  select: vi.fn(),
};
mockQuery.from.mockReturnValue(mockQuery);
mockQuery.select.mockReturnValue(mockQuery);
mockQuery.eq.mockReturnValue(mockQuery);

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

import { GET } from './route';

describe('GET /api/integrations/ads/google/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: mockQuery,
      user: { id: 'user-1' },
    });
    mockGetUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValue(true);
    mockQuery.maybeSingle.mockResolvedValue({
      data: {
        created_at: '2026-08-21T00:00:00.000Z',
        last_synced_at: null,
        provider: 'google_ads',
        provider_customer_id: null,
        status: 'active',
        token_expires_at: null,
        updated_at: '2026-08-21T00:00:00.000Z',
      },
      error: null,
    });
  });

  it('returns 401 for an unauthenticated request', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/status')
    );
    expect(response.status).toBe(401);
  });

  it('returns connection metadata without encrypted token columns', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/status')
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.connection.provider).toBe('google_ads');
    expect(json.connection.needsAccountSelection).toBe(true);
    expect(JSON.stringify(json)).not.toContain('token_ciphertext');
  });
});
