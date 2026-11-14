import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicBootstrap, PublicProduct } from '@baci/shared/experience';
import { createClient } from '@supabase/supabase-js';
import { decodeJwt, importJWK, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));
const clients = vi.hoisted(() => ({ owner: undefined as unknown }));
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: async () => clients.owner,
}));

import { getMerchantRateQuotes } from '@/app/api/shipping/quotes/merchant-rate-quotes';
import { loadOwnerPreviewCatalog } from '@/lib/experience/catalog-adapter';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { startProductionBuilderStack } from '@/lib/experience/production-builder-stack';
import { createPublicOutputReader } from '@/lib/experience/public-output-reader';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { createLinkedSessionService } from '../../tools/builder-auth/session-service';
import { startPublishedGateway } from '../../tools/experience-runner/published-gateway';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import {
  installCombinedCartFixture,
  installCombinedCatalogFixture,
  installCombinedPublicCatalogFixture,
  installCombinedShippingFixture,
  setSyntheticShippingOrigin,
} from './combined-cart-fixture.test-support';
import { startCombinedStorefrontServer } from './combined-storefront-server.test-support';
import { experienceDataFixture } from './data-fixture.test-support';
import { setupNewMerchantRunner } from './new-merchant-runner.test-support';
import { checkPrivatePreviewBrowser } from './private-preview-browser.test-support';
import { checkPublicStorefrontBrowser } from './public-storefront-browser.test-support';
import { syntheticInteractiveSource } from './synthetic-interactive-source.test-support';
import { syntheticOAuth } from './synthetic-oauth.test-support';
import { seedSyntheticPublicRead } from './synthetic-public-read.test-support';

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('NO_PORT');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

it('links a new synthetic user and creates a private merchant through MCP under RLS', async () => {
  const f = await experienceDataFixture({ tokenTtlSeconds: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'baci-new-merchant-'));
  let stack:
    | Awaited<ReturnType<typeof startProductionBuilderStack>>
    | undefined;
  let runner: Awaited<ReturnType<typeof setupNewMerchantRunner>> | undefined;
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
    let token = await oauth.refresh();
    const { publicJwk } = oauth;
    runner = await setupNewMerchantRunner(newUser);
    const background = process.env.BACI_LOCAL_BACKGROUND_BUILD_TEST === '1';
    const resolveLinkedAccessToken = createLinkedSessionService({
      storage: f.db.storage,
      refresh: async () => {
        throw Error('Unexpected refresh');
      },
      verifyUser: async (accessToken) => {
        if (accessToken !== f.other.accessToken)
          throw Error('Wrong synthetic user');
        return actorId;
      },
    });
    const port = await unusedPort();
    let deliveryPort = await unusedPort();
    while (deliveryPort === port) deliveryPort = await unusedPort();
    stack = await startProductionBuilderStack({
      port,
      deliveryPort,
      ...(background
        ? {
            backgroundWorker: {
              schedule: (callback: () => void) => {
                const timer = setInterval(callback, 5000);
                return () => clearInterval(timer);
              },
            },
          }
        : {}),
      host: {
        startBroker: async () => ({
          runtime: {
            readConnection: f.db.storage.readConnection,
            resolveLinkedAccessToken,
            listBuildConnections: f.db.storage.listActiveEditConnections,
            resolveBuildToken: resolveLinkedAccessToken,
            resolveBuildUser: async (accessToken: string) => {
              if (accessToken !== f.other.accessToken)
                throw Error('Wrong synthetic user');
              return { actorUserId: actorId, client: f.other.supabase };
            },
          },
          publicBinding: {
            supabase: {
              url: 'https://synthetic.supabase.co',
              anonKey: 'synthetic-public',
            },
            jwks: { keys: [publicJwk] },
          },
          close: async () => {},
        }),
        integration: {
          hostOrigin: 'https://builder.synthetic.test',
          executionOrigin: 'https://output.synthetic-output.test',
          artifactDirectory: dir,
          canonicalBase: (slug) => `https://${slug}.synthetic.test`,
          publicClient: f.anonymous,
          approval: {
            load: vi.fn(),
            confirm: vi.fn(),
            loadLifecycle: vi.fn(),
            confirmPublication: vi.fn(),
            confirmModeExit: vi.fn(),
          },
          runner: runner.runner,
          build: runner.build,
          bootstrap: runner.bootstrap,
          ...('remoteCapture' in runner
            ? { remoteCapture: runner.remoteCapture }
            : { recordCapture: runner.recordCapture }),
        },
      },
    });
    async function call(name: string, args: Record<string, unknown>) {
      if ((decodeJwt(token).exp ?? 0) <= Math.floor(Date.now() / 1000) + 30)
        token = await oauth.refresh();
      const response = await fetch(`http://127.0.0.1:${port}/builder/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      expect(response.status).toBe(200);
      return response.json();
    }
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
    expect(
      await call('get_experience_capabilities', { storefrontId })
    ).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: { mode: 'full-custom-code', aiProviderCalls: 0 },
        },
      },
    });
    const content = syntheticInteractiveSource;
    const upload = await call('begin_experience_upload', {
      storefrontId,
      manifest: {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        entry: 'app.tsx',
        files: [{ path: 'app.tsx', content: '' }],
        packages: [{ name: 'react', versionRef: 'platform-pinned' }],
        routes: [{ path: '/', view: 'home' }],
        assets: [],
        capabilities: [
          'navigation',
          'catalog.read',
          'cart.read-public',
          'cart.mutate',
          'checkout.prepare',
          'checkout.open',
        ],
      },
      files: {
        files: [
          {
            path: 'app.tsx',
            bytes: Buffer.byteLength(content),
            digest: digestBytes(content),
          },
        ],
      },
    });
    const uploadId = z
      .object({
        result: z.object({
          structuredContent: z.object({
            status: z.literal('ok'),
            value: z.object({ uploadId: z.uuid() }),
          }),
        }),
      })
      .parse(upload).result.structuredContent.value.uploadId;
    expect(
      await call('write_experience_chunk', {
        storefrontId,
        uploadId,
        path: 'app.tsx',
        offset: 0,
        bytesBase64: Buffer.from(content).toString('base64'),
        chunkDigest: digestBytes(content),
      })
    ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
    const finished = await call('finalize_experience_upload', {
      storefrontId,
      uploadId,
    });
    const artifactId = z
      .object({
        result: z.object({
          structuredContent: z.object({
            status: z.literal('ok'),
            value: z.object({ artifactId: z.uuid() }),
          }),
        }),
      })
      .parse(finished).result.structuredContent.value.artifactId;
    const queued = await call('build_experience', {
      storefrontId,
      artifactId,
      idempotencyKey: randomUUID(),
    });
    const jobId = z
      .object({
        result: z.object({
          structuredContent: z.object({
            status: z.literal('ok'),
            value: z.object({ jobId: z.uuid() }),
          }),
        }),
      })
      .parse(queued).result.structuredContent.value.jobId;
    const currency = await (async () => {
      if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST !== '1')
        return undefined;
      const merchantCurrency = await f.other.supabase
        .from('merchants')
        .select('country,payout_currency')
        .eq('id', storefrontId)
        .single();
      expect(merchantCurrency.error).toBeNull();
      if (!merchantCurrency.data) throw Error('SYNTHETIC_MERCHANT_MISSING');
      expect(merchantCurrency.data.country).toBe('US');
      if (process.env.BACI_LOCAL_PUBLIC_READ_TEST === '1') {
        await setSyntheticShippingOrigin(f.other, storefrontId);
      }
      const currency = resolveMerchantCurrencyConfig(
        merchantCurrency.data
      ).code;
      await f.db.pool.query(
        `UPDATE merchants SET premium_features='["shared_cart"]' WHERE id=$1`,
        [storefrontId]
      );
      const zone = await f.other.supabase
        .from('merchant_shipping_zones')
        .insert({ merchant_id: storefrontId, name: 'Synthetic US' })
        .select('id')
        .single();
      expect(zone.error).toBeNull();
      if (!zone.data) throw Error('SYNTHETIC_ZONE_MISSING');
      const foreignRate = await f.owner.supabase
        .from('merchant_shipping_rates')
        .insert({
          merchant_id: storefrontId,
          zone_id: zone.data.id,
          name: 'Denied foreign rate',
          kind: 'ship',
          currency,
          base_amount: 1,
          condition_type: 'always',
        });
      expect(foreignRate.error).not.toBeNull();
      const anonymousRates = await f.anonymous
        .from('merchant_shipping_rates')
        .select('id');
      expect(anonymousRates.error).not.toBeNull();
      expect(
        (
          await f.other.supabase
            .from('merchant_shipping_zone_locations')
            .insert({
              zone_id: zone.data.id,
              country_code: 'US',
              subdivision_code: null,
            })
        ).error
      ).toBeNull();
      expect(
        (
          await f.other.supabase.from('merchant_shipping_rates').insert({
            merchant_id: storefrontId,
            zone_id: zone.data.id,
            name: 'Synthetic delivery',
            kind: 'ship',
            currency,
            base_amount: 1500,
            condition_type: 'always',
          })
        ).error
      ).toBeNull();
      return currency;
    })();
    process.stderr.write('SYNTHETIC_STAGE build_start\n');
    let finalized = await call('finalize_experience_build', {
      storefrontId,
      jobId,
      idempotencyKey: randomUUID(),
    });
    if (background) {
      expect(finalized).toMatchObject({
        result: { structuredContent: { status: 'ok', value: { id: jobId } } },
      });
      const deadline = Date.now() + 420000;
      let completed = false;
      let previousStatus: string | undefined;
      while (Date.now() < deadline) {
        const status = await call('get_experience_operation', {
          storefrontId,
          jobId,
        });
        const value = status?.result?.structuredContent?.value;
        if (value?.status && value.status !== previousStatus) {
          previousStatus = value.status;
          process.stderr.write(`SYNTHETIC_JOB ${value.status}\n`);
        }
        if (value?.status === 'finalized') {
          finalized = status;
          completed = true;
          break;
        }
        if (value?.status === 'failed' || value?.status === 'cancelled') {
          const calls = await Promise.allSettled(
            runner.execute.mock.results.map((result) => result.value)
          );
          const stages = runner.execute.mock.calls.map(([kind], i) => {
            const result = calls[i];
            const reason =
              result?.status === 'rejected'
                ? `:${result.reason instanceof Error ? result.reason.name : 'UNKNOWN_ERROR'}`
                : '';
            return `${kind}:${result?.status ?? 'unknown'}${reason}`;
          });
          throw Error(`SYNTHETIC_BUILD_${value.status}:${stages.join(',')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (!completed) throw Error('SYNTHETIC_BUILD_POLL_TIMEOUT');
    }
    if (runner.useLocalRunner) {
      expect(finalized, JSON.stringify(finalized)).toMatchObject({
        result: { structuredContent: { status: 'ok' } },
      });
      const buildId = background
        ? z
            .object({
              result: z.object({
                structuredContent: z.object({
                  status: z.literal('ok'),
                  value: z.object({
                    status: z.literal('finalized'),
                    buildId: z.uuid(),
                  }),
                }),
              }),
            })
            .parse(finalized).result.structuredContent.value.buildId
        : z
            .object({
              result: z.object({
                structuredContent: z.object({
                  status: z.literal('ok'),
                  value: z.object({
                    buildId: z.uuid(),
                    performance: z.object({
                      status: z.literal('not-measured'),
                      releaseQualified: z.literal(false),
                    }),
                  }),
                }),
              }),
            })
            .parse(finalized).result.structuredContent.value.buildId;
      process.stderr.write('SYNTHETIC_STAGE build_finalized\n');
      const preview = await call('preview_experience', {
        storefrontId,
        buildId,
        routeId: 'home',
        idempotencyKey: randomUUID(),
      });
      expect(preview, JSON.stringify(preview)).toMatchObject({
        result: {
          structuredContent: {
            status: 'ok',
            value: { buildId, evidenceId: expect.any(String) },
          },
        },
      });
      const ownerRuntime = getExperienceOwnerRuntime();
      if (!ownerRuntime) throw Error('OWNER_RUNTIME_MISSING');
      const launch = z
        .object({
          src: z.url(),
          renderMode: z.literal('prerender'),
          buildDigest: z.string(),
          expiresAt: z.number(),
          bootstrap: z.custom<PublicBootstrap>(),
        })
        .parse(
          await ownerRuntime.createPreviewLaunch(
            {
              ...f.other,
              merchantId: storefrontId,
              requestOrigin: 'https://builder.synthetic.test',
            },
            { buildId, routeId: 'home' }
          )
        );
      const delivered = await stack.deliver(new Request(launch.src));
      expect(delivered.status).toBe(200);
      const deliveredHtml = await delivered.text();
      expect(deliveredHtml).toContain('New synthetic store');
      expect(deliveredHtml).toContain('Synthetic New Merchant Device');
      if (process.env.BACI_LOCAL_PREVIEW_BROWSER_TEST === '1') {
        const activeStack = stack;
        if (!activeStack) throw Error('LOCAL_STACK_MISSING');
        await checkPrivatePreviewBrowser(
          {
            ...launch,
            instanceId: randomUUID(),
            nonce: randomUUID(),
            routes: [{ path: '/', view: 'home' }],
            canonicalBase: 'https://synthetic.synthetic.test',
          },
          (request) => activeStack.deliver(request)
        );
      }
      if (process.env.BACI_LOCAL_PUBLIC_READ_TEST === '1') {
        // This is a synthetic read projection in the disposable DB, not a publication operation.
        await f.db.pool.query(
          `UPDATE merchants SET premium_features='["shared_cart"]' WHERE id=$1`,
          [storefrontId]
        );
        const publicHead = await seedSyntheticPublicRead(
          f,
          storefrontId,
          buildId
        );
        const gateway = await startPublishedGateway(
          createPublicOutputReader(f.anonymous),
          'https://synthetic.synthetic.test'
        );
        try {
          const page = await fetch(
            `${gateway.origin}/published/${publicHead.slug}/${publicHead.digest}/index.html`
          );
          expect(page.status).toBe(200);
          const source = await fetch(
            `${gateway.origin}/published/${publicHead.slug}/${publicHead.digest}/app.js`
          );
          expect(source.status).toBe(200);
          const runtime = createPublicExperienceRuntime({
            client: f.anonymous,
            runtimeBase: 'https://output.synthetic-output.test',
            canonicalBase: () => 'https://synthetic.synthetic.test',
          });
          const boundary = await runtime.resolveBoundary(
            { id: storefrontId, slug: publicHead.slug },
            '/'
          );
          expect(boundary?.bootstrap.catalog.products).toContainEqual(
            expect.objectContaining({
              id: ownerProduct.data.id,
              name: product.name,
            })
          );
          if (process.env.BACI_LOCAL_PUBLIC_BROWSER_TEST === '1') {
            if (!commerceApi) throw Error('LOCAL_COMMERCE_API_MISSING');
            const storefront = await startCombinedStorefrontServer(
              commerceApi,
              dir
            );
            try {
              process.stderr.write('SYNTHETIC_STAGE public_browser_start\n');
              await checkPublicStorefrontBrowser({
                storefrontOrigin: storefront.origin,
                gatewayOrigin: gateway.origin,
                dataOrigin: commerceApi.url,
                dataKey: commerceApi.anonKey,
              });
              process.stderr.write('SYNTHETIC_STAGE public_browser_finished\n');
            } finally {
              await storefront.close();
            }
          }
        } finally {
          await gateway.close();
        }
      }
    } else {
      expect(finalized).toMatchObject({
        result: { structuredContent: { status: 'error', code: 'UNAVAILABLE' } },
      });
    }
    if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST === '1') {
      const api = commerceApi;
      if (!api) throw Error('LOCAL_COMMERCE_API_MISSING');
      if (!currency) throw Error('SYNTHETIC_CURRENCY_MISSING');
      const claims = {
        role: 'commerce_cart_shopper',
        exp: Math.floor(Date.now() / 1000) + 3600,
        cart_scope: 'bootstrap',
        cart_merchant_id: storefrontId,
        cart_principal_id: 'synthetic-new-merchant-guest',
      };
      if (api.privateJwk.kty !== 'EC') throw Error('INVALID_FIXTURE_KEY');
      const key = await importJWK({ ...api.privateJwk, kty: 'EC' }, 'ES256');
      const scopedClient = async (scope: Record<string, unknown>) => {
        const signed = await new SignJWT(scope)
          .setProtectedHeader({ alg: 'ES256', kid: api.privateJwk.kid })
          .setAudience('authenticated')
          .setExpirationTime('10m')
          .sign(key);
        return createClient(api.url, api.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${signed}` } },
        });
      };
      const bootstrapClient = await scopedClient(claims);
      const createdResponse = await bootstrapClient.rpc(
        'commerce_cart_create',
        {
          p_operation_id: randomUUID(),
          p_lines: [],
          p_currency: currency,
        }
      );
      expect(createdResponse.error).toBeNull();
      const createdCart = createdResponse.data;
      expect(createdCart.ok, JSON.stringify(createdCart)).toBe(true);
      const session = {
        ...claims,
        cart_scope: 'session',
        cart_id:
          createdCart.state.cartId ??
          createdCart.state.cart_id ??
          createdCart.state.id,
        cart_grant_id: createdCart.grantId,
      };
      const shopper = await scopedClient(session);
      const addedResponse = await shopper.rpc('commerce_cart_mutate', {
        p_cart_id: session.cart_id,
        p_operation_id: randomUUID(),
        p_expected_version: 1,
        p_command: {
          type: 'add',
          item: { productId: ownerProduct.data?.id },
          quantity: 1,
        },
      });
      expect(addedResponse.error).toBeNull();
      const added = addedResponse.data;
      expect(added.ok, JSON.stringify(added)).toBe(true);
      const reviewResponse = await shopper.rpc(
        'commerce_cart_prepare_checkout',
        {
          p_cart_id: session.cart_id,
          p_expected_version: added.state.version,
          p_operation_id: randomUUID(),
        }
      );
      expect(reviewResponse.error).toBeNull();
      const review = reviewResponse.data;
      expect(review.ok, JSON.stringify(review)).toBe(true);
      process.stderr.write('SYNTHETIC_STAGE shipping_quote_start\n');
      const shipping = await getMerchantRateQuotes(f.anonymous, {
        merchantId: storefrontId,
        receiverCountryCode: 'US',
        receiverState: 'California',
        merchantCurrency: currency,
        cartSubtotal: 250,
      });
      expect(shipping.quotes).toContainEqual(
        expect.objectContaining({
          provider: 'MERCHANT',
          displayName: 'Synthetic delivery',
          price: 1500,
          currency,
        })
      );
      await expect(
        f.db.pool.query(
          "INSERT INTO orders(merchant_id,order_number) VALUES($1,'synthetic-denied')",
          [storefrontId]
        )
      ).rejects.toThrow('LOCAL_FIXTURE_ORDERS_DISABLED');
      expect(
        (await f.db.pool.query('SELECT count(*) FROM orders')).rows[0].count
      ).toBe('0');
    }
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
    await commerceApi?.close();
    clients.owner = undefined;
    rmSync(dir, { recursive: true, force: true });
    await f.close();
  }
}, 900000);
