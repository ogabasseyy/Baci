import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: async () => ({ user: { id: 'owner' } }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));
vi.mock('@/lib/go54', () => ({ lookupDomain: lookup }));
afterEach(() => vi.restoreAllMocks());
it.each([
  '%s',
  '%o',
  '%c',
])('keeps provider suggestion %s out of the log format', async (suggestion) => {
  const failure = new Error('synthetic lookup failed');
  lookup
    .mockReset()
    .mockResolvedValueOnce({
      domain: 'shop.com',
      status: 'available',
      premium: false,
      suggestions: [suggestion],
      pricing: {
        domainregister: [{ price: '1' }],
        domainrenew: [{ price: '1' }],
      },
    })
    .mockRejectedValueOnce(failure);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await POST(
    new NextRequest('https://usebaci.com/api/domains/check-availability', {
      method: 'POST',
      body: JSON.stringify({ searchTerm: 'shop' }),
    })
  );
  expect(response.status).toBe(200);
  expect((await response.json()).results).toHaveLength(1);
  expect(logged).toHaveBeenCalledWith('Error looking up domain suggestion:', {
    suggestion,
    error: failure,
  });
});
