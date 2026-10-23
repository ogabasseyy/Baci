import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';
import { previewStorefront } from './preview';

vi.mock('@/lib/store-readiness/load-store-launch-readiness', () => ({
  loadStoreLaunchReadiness: vi.fn(async () => ({
    items: [{ id: 'first_product', priority: 'required', completed: false }],
    totalProductCount: 0,
  })),
}));
const version = `draft:${merchant.id}`;
function fixture() {
  const row = {
    id: merchant.id,
    business_name: merchant.business_name,
    slug: merchant.slug,
    template_id: 'puck',
    draft_config: home,
    version,
    is_published: false,
  };
  const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  const queries: { table: string; filters: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const query = { table, filters: [] as unknown[] };
    queries.push(query);
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((...args: unknown[]) => {
        query.filters.push(args);
        return chain;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: catalog.products.map((p) => ({ ...p, images: [] })),
        error: null,
      }),
      single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
    };
    return chain;
  });
  const ctx: BuilderContext = {
    merchantId: merchant.id,
    identity: {
      actorUserId: merchant.id,
      connectionId: merchant.id,
      grantVersion: 1,
      scopes: new Set(['storefront.read']),
      allowedMerchantIds: [merchant.id],
      allowCreateStore: false,
    },
    supabase: { rpc, from } as unknown as SupabaseClient<
      import('@/types/supabase').Database
    >,
  };
  const input = {
    storefrontId: merchant.id,
    expectedVersion: version,
    pageSlug: 'home' as const,
  };
  return { ctx, input, rpc, from, row, queries };
}
describe('authorized exact homepage preview', () => {
  it('projects real identity and only published catalog fields, checks authority again and never writes', async () => {
    const f = fixture();
    const result = await previewStorefront(f.ctx, f.input);
    expect(result).toMatchObject({
      version,
      projection: {
        identity: merchant,
        inert: true,
        catalog: { merchantId: merchant.id },
      },
    });
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(
      f.queries.find((q) => q.table === 'products')?.filters
    ).toContainEqual(['status', 'active']);
    expect(
      f.queries.every((q) =>
        q.filters.some(
          (a) =>
            JSON.stringify(a) ===
            JSON.stringify([
              q.table === 'products' ? 'merchant_id' : 'id',
              merchant.id,
            ])
        )
      )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /actorUserId|connectionId|grantVersion|images/
    );
  });
  it('returns stale without reading catalog; rejects other tenants, pages and unsupported templates', async () => {
    const f = fixture();
    expect(
      await previewStorefront(f.ctx, {
        ...f.input,
        expectedVersion: `draft:20000000-0000-4000-8000-000000000002`,
      })
    ).toMatchObject({ code: 'STALE_DRAFT', currentVersion: version });
    expect(f.from).not.toHaveBeenCalled();
    await expect(
      previewStorefront(f.ctx, {
        ...f.input,
        storefrontId: '20000000-0000-4000-8000-000000000002',
      })
    ).rejects.toThrow('not found');
    await expect(
      previewStorefront(f.ctx, { ...f.input, pageSlug: 'about' } as never)
    ).rejects.toThrow('homepage');
    f.row.template_id = 'custom';
    await expect(previewStorefront(f.ctx, f.input)).rejects.toThrow(
      'Baci editor'
    );
  });
  it('does not release a snapshot after canonical revocation or a concurrent revision change', async () => {
    const f = fixture();
    f.rpc
      .mockResolvedValueOnce({ data: [f.row], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'CONNECTION_REVOKED' },
      });
    await expect(previewStorefront(f.ctx, f.input)).rejects.toThrow(
      'Reconnect'
    );
    const g = fixture();
    g.rpc
      .mockResolvedValueOnce({ data: [g.row], error: null })
      .mockResolvedValueOnce({
        data: [
          { ...g.row, version: 'draft:20000000-0000-4000-8000-000000000002' },
        ],
        error: null,
      });
    expect(await previewStorefront(g.ctx, g.input)).toMatchObject({
      code: 'STALE_DRAFT',
    });
  });
  it('rejects credential URLs hidden in CSS theme backgrounds, including escaped image functions', async () => {
    for (const background of [
      'url(https://example.supabase.co/storage/v1/object/sign/private/a?token=SECRET)',
      String.raw`u\72l(https://usebaci.com/private)`,
      'image-set("https://usebaci.com/private?token=SECRET" 1x)',
    ]) {
      const f = fixture();
      f.row.draft_config = {
        ...home,
        theme: { colors: { background } },
      } as never;
      await expect(previewStorefront(f.ctx, f.input)).rejects.toThrow(
        'Baci editor'
      );
    }
  });
  it('rejects unsafe credential assets and unsupported blocks instead of silently changing a site', async () => {
    const f = fixture();
    f.row.draft_config = {
      ...home,
      content: [{ type: 'Script', props: { id: 'bad' } }],
    } as never;
    await expect(previewStorefront(f.ctx, f.input)).rejects.toThrow(
      'Baci editor'
    );
    const g = fixture();
    g.row.draft_config = {
      ...home,
      content: [
        {
          type: 'Hero',
          props: {
            id: 'hero',
            title: 'Hi',
            backgroundImage: 'https://user:secret@usebaci.com/logo.png',
          },
        },
      ],
    } as never;
    await expect(previewStorefront(g.ctx, g.input)).rejects.toThrow(
      'Baci editor'
    );
  });
});
