// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { loadOwnerPreviewCatalog } from './catalog-adapter';

function fixture(serialized = false, withVariant = false) {
  let allowed = true;
  const product = {
    id: 'p1',
    merchant_id: 'merchant-a',
    slug: 'phone',
    name: 'Synthetic phone',
    price: 12500,
    status: 'active',
    manage_stock: false,
    stock: 0,
    stock_quantity: 0,
    images: [],
    category: 'Phones',
    cost_price: 1,
    inventory_tracking_policy: serialized ? 'serialized_strict' : 'off',
    has_variants: withVariant,
  };
  const auth = {
    getUser: vi.fn(async () => ({
      data: { user: allowed ? { id: 'owner' } : null },
      error: null,
    })),
  };
  const rpc = vi.fn(async (name: string, _args?: unknown) =>
    name === 'experience_authorize_read'
      ? { data: allowed, error: null }
      : {
          data:
            name === 'experience_owner_serialized_availability_counts'
              ? [
                  {
                    product_id: 'p1',
                    variant_id: withVariant ? 'v1' : null,
                    public_available_units: 2,
                  },
                ]
              : name === 'get_storefront_product_variants' && withVariant
                ? [
                    {
                      id: 'v1',
                      product_id: 'p1',
                      effective_policy: 'serialized_strict',
                      available_units: 0,
                      stock_quantity: 0,
                    },
                  ]
                : [],
          error: null,
        }
  );
  const from = vi.fn((table: string) =>
    Object.assign(
      Promise.resolve({
        data:
          table === 'products'
            ? [product]
            : withVariant && table === 'product_variants'
              ? [
                  {
                    id: 'v1',
                    product_id: 'p1',
                    inventory_tracking_policy: 'inherit',
                    is_inventory_anchor: false,
                  },
                ]
              : [],
        error: null,
      }),
      {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        returns: vi.fn().mockReturnThis(),
        maybeSingle: async () => ({
          data:
            table === 'merchants'
              ? {
                  id: 'merchant-a',
                  payout_currency: 'NGN',
                  is_published: false,
                }
              : { generation: 1 },
          error: null,
        }),
      }
    )
  );
  return {
    ctx: { merchantId: 'merchant-a', supabase: { auth, rpc, from } as never },
    rpc,
    auth,
    from,
    revoke: () => {
      allowed = false;
    },
  };
}

it('loads unpublished catalog only after owner authorization and returns public-safe fields', async () => {
  const f = fixture();
  const result = await loadOwnerPreviewCatalog(f.ctx, {});
  expect(result?.catalog.products).toHaveLength(1);
  expect(result?.catalog.products[0]).toMatchObject({
    name: 'Synthetic phone',
    currency: 'NGN',
  });
  expect(JSON.stringify(result)).not.toMatch(
    /cost_price|merchant_id|stock_quantity/
  );
  expect(
    f.rpc.mock.calls.filter(([name]) => name === 'experience_authorize_read')
  ).toHaveLength(2);
});

it('rejects unauthorized owners before reading merchant data', async () => {
  const f = fixture();
  f.revoke();
  await expect(loadOwnerPreviewCatalog(f.ctx, {})).rejects.toThrow('NOT_FOUND');
  expect(f.from).not.toHaveBeenCalled();
});

it('does not return catalog data after the owner session is revoked mid-read', async () => {
  const f = fixture();
  f.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: 'owner' } },
    error: null,
  });
  f.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  await expect(loadOwnerPreviewCatalog(f.ctx, {})).rejects.toThrow('NOT_FOUND');
});

it('rejects a connection that is not scoped to the requested merchant', async () => {
  const f = fixture();
  const identity = {
    actorUserId: 'owner',
    connectionId: 'connection',
    grantVersion: 1,
    scopes: new Set(['storefront.read'] as const),
    allowedMerchantIds: ['other-merchant'],
    allowCreateStore: false,
  };
  await expect(
    loadOwnerPreviewCatalog({ ...f.ctx, identity }, {})
  ).rejects.toThrow('INSUFFICIENT_SCOPE');
  expect(f.from).not.toHaveBeenCalled();
});

it('loads available serialized units for an unpublished storefront through the owner RPC', async () => {
  const f = fixture(true);
  const result = await loadOwnerPreviewCatalog(f.ctx, {});
  expect(f.rpc).toHaveBeenCalledWith(
    'experience_owner_serialized_availability_counts',
    {
      p_merchant: 'merchant-a',
      p_connection: null,
      p_version: null,
      p_product_ids: ['p1'],
    }
  );
  expect(result?.catalog.products[0]?.available).toBe(true);
});

it('replaces the public zero-unit count for an unpublished serialized variant', async () => {
  const f = fixture(true, true);
  const result = await loadOwnerPreviewCatalog(f.ctx, {});
  expect(result?.catalog.products[0]).toMatchObject({
    available: true,
    requiresVariant: true,
    variants: [{ id: 'v1', available: true }],
  });
});
