import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import type { PublicBootstrap } from '@baci/shared/experience';
import { expect } from 'vitest';
import { z } from 'zod';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { createPublicOutputReader } from '@/lib/experience/public-output-reader';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { startPublishedGateway } from '../../tools/experience-runner/published-gateway';
import type { startCommerceDataApi } from '../experience-commerce/data-api';
import { startCombinedStorefrontServer } from './combined-storefront-server.test-support';
import type { experienceDataFixture } from './data-fixture.test-support';
import type { finalizeNewMerchantBuild } from './new-merchant-build.test-support';
import type {
  NewMerchantMcpCall,
  startNewMerchantMcp,
} from './new-merchant-mcp.test-support';
import { checkPrivatePreviewBrowser } from './private-preview-browser.test-support';
import { checkPublicStorefrontBrowser } from './public-storefront-browser.test-support';
import { seedSyntheticPublicRead } from './synthetic-public-read.test-support';

export async function checkNewMerchantDelivery({
  f,
  stack,
  call,
  storefrontId,
  finalized,
  background,
  useLocalRunner,
  productId,
  productName,
  commerceApi,
  dir,
}: {
  f: Awaited<ReturnType<typeof experienceDataFixture>>;
  stack: Awaited<ReturnType<typeof startNewMerchantMcp>>['stack'];
  call: NewMerchantMcpCall;
  storefrontId: string;
  finalized: Awaited<ReturnType<typeof finalizeNewMerchantBuild>>;
  background: boolean;
  useLocalRunner: boolean;
  productId: string;
  productName: string;
  commerceApi: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  dir: string;
}) {
  if (useLocalRunner) {
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
    expect(
      readdirSync(dir).some((name) => /^[a-f0-9]{64}\.json$/.test(name))
    ).toBe(false);
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
      const nativeCheckout =
        process.env.BACI_LOCAL_NATIVE_CHECKOUT_TEST === '1';
      if (nativeCheckout) {
        const enrollment = await f.other.supabase
          .from('merchants')
          .select('premium_features')
          .eq('id', storefrontId)
          .single();
        expect(enrollment.error).toBeNull();
        expect(enrollment.data?.premium_features).toEqual([]);
      } else {
        await f.db.pool.query(
          `UPDATE merchants SET premium_features='["shared_cart"]' WHERE id=$1`,
          [storefrontId]
        );
      }
      const publicHead = await seedSyntheticPublicRead(
        f,
        storefrontId,
        buildId
      );
      // Exercise the exact anonymous cart hydration projection before the
      // browser starts, so a fixture schema error cannot look like a channel timeout.
      const hydration = await f.anonymous
        .from('products')
        .select(HYDRATION_SELECT)
        .eq('merchant_id', storefrontId)
        .in('id', [productId])
        .eq('status', 'active');
      expect(hydration.error).toBeNull();
      expect(hydration.data).toMatchObject([{ id: productId }]);
      const publishedDocument = await stack.deliver(
        new Request(
          `https://output.synthetic-output.test/published/${publicHead.slug}/${publicHead.digest}/index.html`
        )
      );
      expect(publishedDocument.status).toBe(200);
      expect(await publishedDocument.text()).toContain(productName);
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
            id: productId,
            name: productName,
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
              ...(nativeCheckout ? { nativeProductId: productId } : {}),
            });
            process.stderr.write('SYNTHETIC_STAGE public_browser_finished\n');
          } catch (error) {
            const summary = storefront
              .output()
              .split('\n')
              .filter((line) =>
                /\/api\/storefront\/experience\/(state|launch)|Compil|Ready/.test(
                  line
                )
              )
              .slice(-16)
              .join('\n');
            process.stderr.write(`Synthetic storefront timing:\n${summary}\n`);
            throw error;
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
}
