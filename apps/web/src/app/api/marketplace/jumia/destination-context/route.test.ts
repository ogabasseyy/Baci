import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), shops: vi.fn() }));
vi.mock('@/lib/jumia/metadata-request', () => ({
  authorizeJumiaMetadata: mocks.authorize,
}));

import { GET } from './route';

const request = new NextRequest('http://localhost/api');
const client = (code: string) => ({
  code,
  name: code,
  countryCode: 'NG',
  shortCode: code,
  status: 'active',
});
const shop = {
  id: 'shop',
  name: 'Shop',
  email: 'shop@example.com',
  businessClients: [
    client('jumia-ng'),
    client('jumia-gh'),
    { ...client('inactive'), status: 'inactive' },
  ],
};
describe('destination context GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shops.mockResolvedValue([shop, { ...shop, id: 'other' }]);
    mocks.authorize.mockResolvedValue({
      client: {
        shopId: 'shop',
        marketplaceKey: 'jumia-ng',
        getShops: mocks.shops,
      },
    });
  });
  it.each([
    'jumia-ng',
    'jumia-gh',
  ])('binds same-shop integrations to their exact key %s', async (marketplaceKey) => {
    mocks.authorize.mockResolvedValue({
      client: { shopId: 'shop', marketplaceKey, getShops: mocks.shops },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      businessClients: [
        { code: marketplaceKey, name: marketplaceKey, countryCode: 'NG' },
      ],
    });
    expect(mocks.authorize).toHaveBeenCalledWith(request, true);
  });
  it('offers only active exact-shop clients for legacy shared integration', async () => {
    mocks.authorize.mockResolvedValue({
      client: {
        shopId: 'shop',
        marketplaceKey: 'oauth',
        getShops: mocks.shops,
      },
    });
    const response = await GET(request);
    expect((await response.json()).businessClients).toHaveLength(2);
  });
  it.each([
    'oauth',
    'missing',
  ])('fails closed without a real exact provider shop: %s', async (shopId) => {
    mocks.authorize.mockResolvedValue({
      client: { shopId, marketplaceKey: 'oauth', getShops: mocks.shops },
    });
    expect((await GET(request)).status).toBe(409);
  });
  it('rejects ambiguous duplicate shop bindings', async () => {
    mocks.shops.mockResolvedValue([shop, shop]);
    expect((await GET(request)).status).toBe(409);
  });
  it('returns no sibling destination when the integration key is absent', async () => {
    mocks.authorize.mockResolvedValue({
      client: {
        shopId: 'shop',
        marketplaceKey: 'other-client',
        getShops: mocks.shops,
      },
    });
    expect(await (await GET(request)).json()).toEqual({ businessClients: [] });
  });
  it('does not call shops when authorization fails', async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response('{}', { status: 403 }),
    });
    expect((await GET(request)).status).toBe(403);
    expect(mocks.shops).not.toHaveBeenCalled();
  });
  it('fails closed on malformed provider data without leaking details', async () => {
    mocks.shops.mockResolvedValue([{ secret: 'token' }]);
    const response = await GET(request);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('token');
  });
  it('handles provider failure safely', async () => {
    mocks.shops.mockRejectedValue(new Error('secret'));
    const response = await GET(request);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
