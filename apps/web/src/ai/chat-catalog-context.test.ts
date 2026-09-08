import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  lookup: vi.fn(),
  client: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/get-merchant-by-identifier-or-alias', () => ({
  getMerchantByIdentifierOrAlias: mocks.lookup,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));

import { getChatCatalogContext } from './chat-catalog-context';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ id: 'live-merchant-id', slug: 'ogabassey' });
  mocks.client.mockResolvedValue({ from: vi.fn() });
});

it.each([
  'ogabassey.com',
  'www.ogabassey.com',
  'ogabassey.usebaci.com',
])('resolves %s through the canonical storefront resolver', async (host) => {
  // Arrange
  mocks.headers.mockResolvedValue(new Headers({ host }));
  // Act
  const result = await getChatCatalogContext();
  // Assert
  expect(result.merchantId).toBe('live-merchant-id');
  expect(mocks.lookup).toHaveBeenCalledWith(
    host.endsWith('.usebaci.com') ? 'ogabassey' : 'ogabassey.com'
  );
});

it('does not accept tenant override headers in place of the request host', async () => {
  // Arrange
  mocks.headers.mockResolvedValue(
    new Headers({
      host: 'unknown.example',
      'x-merchant-slug': 'ogabassey',
      'x-custom-domain': 'ogabassey.com',
      'x-forwarded-host': 'ogabassey.com',
    })
  );
  mocks.lookup.mockResolvedValue(null);
  // Act / Assert
  await expect(getChatCatalogContext()).rejects.toThrow(
    'Storefront context unavailable'
  );
  expect(mocks.lookup).toHaveBeenCalledWith('unknown.example');
  expect(mocks.client).not.toHaveBeenCalled();
});

it.each([
  null,
  'usebaci.com',
])('fails closed when the host has no storefront context: %s', async (host) => {
  // Arrange
  mocks.headers.mockResolvedValue(new Headers(host ? { host } : {}));
  // Act / Assert
  await expect(getChatCatalogContext()).rejects.toThrow(
    'Storefront context unavailable'
  );
  expect(mocks.client).not.toHaveBeenCalled();
});

it('fails closed when merchant resolution fails', async () => {
  // Arrange
  mocks.headers.mockResolvedValue(new Headers({ host: 'ogabassey.com' }));
  mocks.lookup.mockRejectedValue(new Error('database offline'));
  // Act / Assert
  await expect(getChatCatalogContext()).rejects.toThrow(
    'Storefront context unavailable'
  );
  expect(mocks.client).not.toHaveBeenCalled();
});
