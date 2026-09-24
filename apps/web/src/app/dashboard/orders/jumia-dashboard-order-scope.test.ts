import { describe, expect, it, vi } from 'vitest';
import { resolveJumiaDashboardOrderScope } from './jumia-dashboard-order-scope';

function supabase(integration: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(integration),
          })),
        })),
      })),
    })),
  } as never;
}

describe('resolveJumiaDashboardOrderScope', () => {
  it('returns undefined when no integration is requested', async () => {
    const from = vi.fn();
    await expect(
      resolveJumiaDashboardOrderScope(
        { from } as never,
        'merchant-1',
        undefined
      )
    ).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it('resolves the shop scope with neutral marketplace keys', async () => {
    const client = supabase({
      data: { shop_id: 'shop-1', marketplace_key: 'NG-main' },
      error: null,
    });

    await expect(
      resolveJumiaDashboardOrderScope(client, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      shopId: 'shop-1',
      marketplaceKeys: ['NG-main', 'default'],
    });
  });

  it('fails closed when the integration is missing or shopless', async () => {
    await expect(
      resolveJumiaDashboardOrderScope(
        supabase({ data: null, error: null }),
        'merchant-1',
        'integration-unknown'
      )
    ).resolves.toBeNull();
    await expect(
      resolveJumiaDashboardOrderScope(
        supabase({
          data: { shop_id: null, marketplace_key: 'NG-main' },
          error: null,
        }),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBeNull();
    await expect(
      resolveJumiaDashboardOrderScope(
        supabase({ data: null, error: { message: 'offline' } }),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBeNull();
  });
});
