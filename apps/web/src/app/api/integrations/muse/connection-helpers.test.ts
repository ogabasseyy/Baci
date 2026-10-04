import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const { authenticate, merchant } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  merchant: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: authenticate }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: merchant,
}));

import { resolveOwnerContext } from './connection-helpers';

beforeEach(() => vi.clearAllMocks());
it('rejects unauthenticated callers before merchant lookup', async () => {
  authenticate.mockResolvedValue({ user: null, error: 'not signed in' });
  const result = await resolveOwnerContext(
    new NextRequest('https://usebaci.com/api/integrations/muse')
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(401);
  expect(merchant).not.toHaveBeenCalled();
});
it('does not allow staff to manage owner-only connector grants', async () => {
  authenticate.mockResolvedValue({
    user: { id: 'owner' },
    supabase: {},
    error: null,
  });
  merchant.mockResolvedValue({
    merchantId: 'merchant',
    staffAccess: { isOwner: false },
  });
  const result = await resolveOwnerContext(
    new NextRequest('https://usebaci.com/api/integrations/muse')
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get('cache-control')).toContain('no-store');
  }
});
