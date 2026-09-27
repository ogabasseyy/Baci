import { describe, expect, it, vi } from 'vitest';
import { verifyJumiaSingleMarketplaceScope } from './verify-jumia-single-marketplace-scope';

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    shopId: 'shop-1',
    marketplaceKey: 'NG-RETAIL',
    getShops: vi.fn().mockResolvedValue([
      {
        id: 'shop-1',
        businessClients: [
          {
            code: 'NG-RETAIL',
            status: 'active',
          },
        ],
      },
    ]),
    ...overrides,
  };
}

describe('verifyJumiaSingleMarketplaceScope', () => {
  it('accepts legacy integrations without a marketplace selector', async () => {
    await expect(
      verifyJumiaSingleMarketplaceScope(
        createClient({ marketplaceKey: 'oauth' })
      )
    ).resolves.toEqual({ ok: true });
  });

  it('accepts the selected marketplace when it is the sole active client', async () => {
    await expect(
      verifyJumiaSingleMarketplaceScope(createClient())
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a shop with multiple active marketplaces', async () => {
    const client = createClient({
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [
            { code: 'NG-RETAIL', status: 'active' },
            { code: 'NG-EXPRESS', status: 'active' },
          ],
        },
      ]),
    });

    await expect(verifyJumiaSingleMarketplaceScope(client)).resolves.toEqual({
      ok: false,
      reason: 'multiple_active_marketplaces',
    });
  });

  it('rejects a selected marketplace that does not match the provider', async () => {
    const client = createClient({
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [{ code: 'NG-EXPRESS', status: 'active' }],
        },
      ]),
    });

    await expect(verifyJumiaSingleMarketplaceScope(client)).resolves.toEqual({
      ok: false,
      reason: 'marketplace_mismatch',
    });
  });

  it('reports provider failures as unavailable scope', async () => {
    const client = createClient({
      getShops: vi.fn().mockRejectedValue(new Error('provider down')),
    });

    await expect(verifyJumiaSingleMarketplaceScope(client)).resolves.toEqual({
      ok: false,
      reason: 'provider_unavailable',
    });
  });

  it('accepts an OAuth shop with a single active marketplace in strict mode', async () => {
    const client = createClient({
      marketplaceKey: 'oauth',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [{ code: 'NG-RETAIL', status: 'active' }],
        },
      ]),
    });

    await expect(
      verifyJumiaSingleMarketplaceScope(client, { strictOAuth: true })
    ).resolves.toEqual({ ok: true });
  });

  it('rejects an OAuth shop with multiple active marketplaces in strict mode', async () => {
    const client = createClient({
      marketplaceKey: 'oauth',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [
            { code: 'NG-RETAIL', status: 'active' },
            { code: 'NG-EXPRESS', status: 'active' },
          ],
        },
      ]),
    });

    await expect(
      verifyJumiaSingleMarketplaceScope(client, { strictOAuth: true })
    ).resolves.toEqual({
      ok: false,
      reason: 'multiple_active_marketplaces',
    });
  });
});
