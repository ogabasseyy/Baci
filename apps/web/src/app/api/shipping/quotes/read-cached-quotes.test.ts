import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('./quote-merchant-context', () => ({
  resolveQuoteMerchantContext: f.context,
}));
vi.mock('@/lib/shipping/storefront-quote-attestation', () => ({
  readStorefrontShippingQuotes: f.read,
}));

import { readCachedShippingQuotes } from './read-cached-quotes';

it('requires normal merchant resolution and continuation; cached output contains no private economics or addresses', async () => {
  const req = new NextRequest(
    'http://localhost/api/shipping/quotes?sessionId=synthetic'
  );
  f.context.mockResolvedValue({ ok: false });
  expect((await readCachedShippingQuotes(req)).status).toBe(403);
  expect(f.read).not.toHaveBeenCalled();
  f.context.mockResolvedValue({ ok: true, merchantId: 'm' });
  f.read.mockResolvedValue({
    data: null,
    error: { code: 'QUOTE_SESSION_REQUIRED' },
  });
  expect((await readCachedShippingQuotes(req)).status).toBe(403);
  f.read.mockResolvedValue({
    error: null,
    data: [
      {
        id: 'q',
        provider: 'GIGL',
        price: 1500,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        provider_cost: 'PRIVATE',
        quote_request: { sender: 'PRIVATE' },
      },
    ],
  });
  const r = await readCachedShippingQuotes(req);
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  const value = await r.text();
  expect(value).toContain('1500');
  expect(value).not.toContain('PRIVATE');
});
