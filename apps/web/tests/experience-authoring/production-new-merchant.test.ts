import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicProduct } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));
const clients = vi.hoisted(() => ({ owner: undefined as unknown }));
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: async () => clients.owner,
}));

import { loadOwnerPreviewCatalog } from '@/lib/experience/catalog-adapter';
import type { startProductionBuilderStack } from '@/lib/experience/production-builder-stack';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import {
  installCombinedCartFixture,
  installCombinedCatalogFixture,
  installCombinedPublicCatalogFixture,
  installCombinedShippingFixture,
} from './combined-cart-fixture.test-support';
import { experienceDataFixture } from './data-fixture.test-support';
import {
  finalizeNewMerchantBuild,
  queueNewMerchantBuild,
} from './new-merchant-build.test-support';
import {
  checkNewMerchantCheckout,
  seedNewMerchantShipping,
} from './new-merchant-commerce.test-support';
import { checkNewMerchantDelivery } from './new-merchant-delivery.test-support';
import { startNewMerchantMcp } from './new-merchant-mcp.test-support';
import { setupNewMerchantRunner } from './new-merchant-runner.test-support';
import { setupPublishedRendererPool } from './published-renderer-pool.test-support';
import { syntheticOAuth } from './synthetic-oauth.test-support';

it('links a new synthetic user and creates a private merchant through MCP under RLS', async () => {
  const f = await experienceDataFixture({ tokenTtlSeconds: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'baci-new-merchant-'));
  let stack:
    | Awaited<ReturnType<typeof startProductionBuilderStack>>
    | undefined;
  let runner: Awaited<ReturnType<typeof setupNewMerchantRunner>> | undefined;
  let rendererPool:
    | Awaited<ReturnType<typeof setupPublishedRendererPool>>
    | undefined;
  let commerceApi: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  try {
    if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST === '1') {
      await installCombinedCartFixture(f);
      await installCombinedCatalogFixture(f);
      await installCombinedShippingFixture(f);
      if (process.env.BACI_LOCAL_PUBLIC_READ_TEST === '1')
        await installCombinedPublicCatalogFixture(f);
      if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
      commerceApi = await startCommerceDataApi({
        pool: f.db.pool,
        connection: { host: f.db.localDatabase.socketDirectory },
      });
    }
    const actorId = f.otherActorId;
    const newUser = { ...f, actorId, owner: f.other };
    clients.owner = f.other.supabase;
    const oauth = await syntheticOAuth(newUser, dir, null);
    const initialToken = await oauth.refresh();
    runner = await setupNewMerchantRunner(newUser);
    rendererPool = await setupPublishedRendererPool(f);
    const mcp = await startNewMerchantMcp(
      f,
      oauth,
      runner,
      dir,
      initialToken,
      rendererPool.read
    );
    stack = mcp.stack;
    const { call, background } = mcp;
    expect(await call('list_storefronts', {})).toMatchObject({
      result: { structuredContent: { stores: [] } },
    });
    const input = {
      businessName: 'Synthetic New Merchant',
      businessType: 'electronics',
      country: 'US',
      requestedSlug: 'synthetic',
      idempotencyKey: randomUUID(),
    };
    const created = await call('create_storefront_draft', input);
    expect(created, JSON.stringify(created)).toMatchObject({
      result: { structuredContent: { status: 'draft' } },
    });
    const result = z
      .object({
        result: z.object({
          structuredContent: z.object({
            status: z.literal('draft'),
            storefrontId: z.uuid(),
          }),
        }),
      })
      .parse(created);
    const storefrontId = result.result.structuredContent.storefrontId;
    const product = {
      merchant_id: storefrontId,
      name: 'Synthetic New Merchant Device',
      price: 250,
      slug: 'synthetic-new-device',
      status: 'active',
      images: [],
    };
    const rejectedProduct = await f.owner.supabase
      .from('products')
      .insert(product);
    expect(rejectedProduct.error).not.toBeNull();
    const ownerProduct = await f.other.supabase
      .from('products')
      .insert(product)
      .select('id,merchant_id,name')
      .single();
    expect(ownerProduct.error).toBeNull();
    expect(ownerProduct.data).toMatchObject({
      merchant_id: storefrontId,
      name: product.name,
    });
    if (!ownerProduct.data) throw Error('SYNTHETIC_PRODUCT_MISSING');
    if (process.env.BACI_LOCAL_PUBLIC_BROWSER_TEST === '1') {
      const update = await f.other.supabase
        .from('products')
        .update({ manage_stock: false })
        .eq('id', ownerProduct.data.id);
      expect(update.error).toBeNull();
    }
    let projectedProduct: PublicProduct = {
      id: ownerProduct.data.id,
      name: ownerProduct.data.name,
      slug: product.slug,
      price: product.price,
      currency: 'NGN',
      image: null,
      variants: [],
      available: true,
      requiresVariant: false,
    };
    if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST === '1') {
      const ownerCatalog = await loadOwnerPreviewCatalog(
        {
          merchantId: storefrontId,
          supabase: f.other.supabase,
          identity: {
            actorUserId: actorId,
            connectionId: oauth.connectionId,
            grantVersion: 1,
            allowedMerchantIds: [storefrontId],
            allowCreateStore: true,
            scopes: new Set(['storefront.read', 'storefront.write']),
          },
        },
        {}
      );
      expect(ownerCatalog?.catalog.products).toHaveLength(1);
      const actual = ownerCatalog?.catalog.products[0];
      if (!actual || actual.id !== ownerProduct.data.id)
        throw Error('OWNER_CATALOG_MISMATCH');
      projectedProduct = actual;
      runner.enableOwnerBootstrap();
    }
    runner.setCatalogProduct(projectedProduct);
    const row = await f.db.pool.query(
      'SELECT user_id, is_published FROM merchants WHERE id=$1',
      [storefrontId]
    );
    expect(row.rows).toEqual([{ user_id: actorId, is_published: false }]);
    expect(await call('create_storefront_draft', input)).toMatchObject({
      result: { structuredContent: { storefrontId, status: 'draft' } },
    });
    expect(await call('list_storefronts', {})).toMatchObject({
      result: { structuredContent: { stores: [{ storefrontId }] } },
    });
    expect(await call('get_storefront_status', { storefrontId })).toMatchObject(
      {
        result: { structuredContent: { storefrontId, isPublished: false } },
      }
    );
    const capabilities = await call('get_experience_capabilities', {
      storefrontId,
    });
    if (!background || !runner.verifier) {
      expect(capabilities).toMatchObject({ error: { code: -32602 } });
      return;
    }
    expect(capabilities).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: { mode: 'full-custom-code', aiProviderCalls: 0 },
        },
      },
    });
    const jobId = await queueNewMerchantBuild(call, storefrontId);
    const currency = await seedNewMerchantShipping(f, storefrontId);
    const finalized = await finalizeNewMerchantBuild(
      call,
      storefrontId,
      jobId,
      runner,
      background
    );
    await checkNewMerchantDelivery({
      f,
      stack,
      call,
      storefrontId,
      finalized,
      background,
      useLocalRunner: runner.useLocalRunner,
      productId: ownerProduct.data.id,
      productName: product.name,
      commerceApi,
      dir,
    });
    await checkNewMerchantCheckout(
      f,
      commerceApi,
      storefrontId,
      ownerProduct.data.id,
      currency
    );
    const otherRead = await f.owner.supabase
      .from('merchants')
      .select('id')
      .eq('id', storefrontId);
    expect(otherRead.error).toBeNull();
    expect(otherRead.data).toEqual(
      process.env.BACI_LOCAL_PUBLIC_READ_TEST === '1'
        ? [{ id: storefrontId }]
        : []
    );
    const foreignJob = await f.owner.supabase
      .from('experience_jobs')
      .select('id')
      .eq('id', jobId);
    expect(foreignJob.error).toBeNull();
    expect(foreignJob.data).toEqual([]);
  } finally {
    await stack?.close();
    await runner?.close();
    await rendererPool?.close();
    await commerceApi?.close();
    clients.owner = undefined;
    rmSync(dir, { recursive: true, force: true });
    await f.close();
  }
}, 900000);
