import { randomUUID } from 'node:crypto';
import type { PublicCatalog } from '@baci/shared/experience';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type MerchantFeatureSource,
  merchantHasFeature,
} from '@/lib/merchant-has-feature';
import { createPublicClient } from '@/lib/supabase/public';
import {
  type ExperienceCatalogMerchant,
  loadExperienceCatalog,
} from './catalog-adapter';
import { digestBytes } from './manifest-digest';
import { buildPublicBootstrap } from './public-bootstrap';
import { loadPublicSnapshot } from './public-snapshot';
import { parsePublishedExperience } from './published-manifest';
import { readPublishedExperienceState } from './published-state';
import { resolveExperienceRoute } from './route-resolver';
import type { ExperienceStorefrontRuntime } from './storefront-runtime';

interface Options {
  prerenderDelivery?: boolean;
  client?: SupabaseClient;
  runtimeBase: string;
  canonicalBase: (slug: string) => string | Promise<string>;
  catalogImages?: ReadonlyMap<string, { assetId: string; alt: string }>;
}
/** Normal anonymous/RLS reads only; startup remains explicitly uninstalled. */
export function createPublicExperienceRuntime(
  options: Options
): ExperienceStorefrontRuntime {
  const client =
    options.client ??
    createPublicClient({ clientInfo: 'baci-experience-public' });
  const base = new URL(options.runtimeBase);
  if (
    base.pathname !== '/' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error('INVALID_RUNTIME_ORIGIN');
  const manifest = async (merchant: { id: string; slug?: string | null }) => {
    if (!merchant.slug) return null;
    const r = await client.rpc('experience_public_manifest', {
      p_slug: merchant.slug,
    });
    if (r.error) throw Error('PUBLIC_UNAVAILABLE');
    if (!r.data) return null;
    const m = parsePublishedExperience(r.data);
    return m.merchantId === merchant.id ? m : null;
  };
  const loadMerchant = async (
    id: string
  ): Promise<
    | (ExperienceCatalogMerchant &
        MerchantFeatureSource & { slug: string; business_name: string })
    | null
  > => {
    const r = await client
      .from('merchants')
      .select(
        'id,slug,business_name,is_published,payout_currency,country,premium_features,plan_tier,plan_expires_at'
      )
      .eq('id', id)
      .maybeSingle();
    if (r.error) throw Error('PUBLIC_UNAVAILABLE');
    if (r.data?.is_published !== true) return null;
    return {
      id: r.data.id,
      slug: r.data.slug,
      business_name: r.data.business_name ?? 'Synthetic store',
      is_published: true,
      currency: r.data.payout_currency ?? 'NGN',
      premium_features: r.data.premium_features,
      plan_tier: r.data.plan_tier,
      plan_expires_at: r.data.plan_expires_at,
    };
  };
  const catalog = async (
    m: ExperienceCatalogMerchant,
    handle?: string,
    productSlug?: string,
    productId?: string
  ): Promise<PublicCatalog | null> => {
    let categoryId: string | undefined;
    if (handle && handle !== 'all') {
      const r = await client
        .from('categories')
        .select('id,slug')
        .eq('merchant_id', m.id)
        .eq('slug', handle)
        .eq('is_active', true)
        .maybeSingle();
      if (r.error) throw Error('CATALOG_UNAVAILABLE');
      if (!r.data) return null;
      categoryId = r.data.id;
    }
    const result = await loadExperienceCatalog(
      client,
      m,
      {
        limit: 100,
        ...(categoryId ? { categoryId } : {}),
        ...(productSlug ? { productSlug } : {}),
        ...(productId ? { productId } : {}),
      },
      options.catalogImages
    );
    if (result)
      result.revision = digestBytes(
        JSON.stringify([result.revision, result.products])
      );
    return result;
  };
  const runtime: ExperienceStorefrontRuntime = {
    loadPublishedManifest: manifest,
    async snapshot(merchant, data) {
      if (!merchant.slug) return null;
      return await loadPublicSnapshot(
        client,
        merchant.slug,
        {
          build: data.manifest.buildDigest,
          assets: data.manifest.assetsDigest,
          catalog: data.bootstrap.catalog.revision,
          path: data.bootstrap.route.canonicalPath,
          viewport: '1440',
          locale: 'en-NG',
          browser: 'chromium',
          state: 'default',
        },
        async () => {
          const state = await runtime.state(
            { id: merchant.id, slug: merchant.slug ?? '' },
            data.manifest.buildDigest,
            data.bootstrap.route.canonicalPath
          );
          return (
            state.active &&
            state.policyRevision === data.manifest.policyRevision &&
            state.catalogRevision === data.bootstrap.catalog.revision
          );
        }
      );
    },
    async catalog(merchant, selection) {
      const head = await manifest(merchant);
      if (!head) return null;
      const m = await loadMerchant(merchant.id);
      return m
        ? catalog(
            m,
            selection.handle,
            selection.productSlug,
            selection.productId
          )
        : null;
    },
    async resolveBoundary(merchant, path) {
      const [head, m] = await Promise.all([
        manifest(merchant),
        loadMerchant(merchant.id),
      ]);
      if (!head || !m || !head.hostOrigin) return null;
      const canonicalBase = (await options.canonicalBase(m.slug)).replace(
        /\/$/,
        ''
      );
      if (new URL(canonicalBase).origin !== head.hostOrigin) return null;
      if (
        head.capabilities.some(
          (c) => c.startsWith('cart.') || c.startsWith('checkout.')
        ) &&
        !merchantHasFeature(m, 'shared_cart')
      )
        return null;
      const data = await catalog(
        m,
        path.startsWith('/collections/') ? path.split('/')[2] : undefined,
        /^\/(?:products|[^/]+)\/[^/]+$/.test(path) &&
          !path.startsWith('/collections/') &&
          !path.startsWith('/pages/')
          ? path.split('/')[2]
          : undefined
      );
      if (!data) return null;
      const resolved = await resolveExperienceRoute(head.routes, path, {
        product: (handle) => {
          const p = data.products.find((p) => p.slug === handle);
          return Promise.resolve(
            p
              ? {
                  id: p.id,
                  canonicalPath: p.canonicalPath ?? `/products/${p.slug}`,
                }
              : null
          );
        },
        collection: (handle) => Promise.resolve({ id: handle }),
      });
      if (resolved.kind !== 'route') return null;
      const route = {
        epoch: 1,
        routeId: resolved.route.view,
        params: resolved.route.params,
        canonicalPath: resolved.route.canonicalPath,
        publicDataRevision: data.revision,
      };
      const bootstrap = buildPublicBootstrap(
        route,
        data,
        head.capabilities,
        m.currency
      );
      const resources = `${base.origin}/published/${m.slug}/${head.buildDigest}`;
      bootstrap.assets = Object.fromEntries(
        (head.assets ?? []).map((a) => [
          a.assetId,
          `${resources}/assets/${a.assetId}`,
        ])
      );
      const launch = {
        instanceId: randomUUID(),
        nonce: randomUUID(),
        buildDigest: head.buildDigest,
        src: `${resources}/index.html${options.prerenderDelivery ? `?path=${encodeURIComponent(path)}` : ''}`,
        expiresAt: Date.now() + 1800000,
        bootstrap,
        routes: head.routes,
        canonicalBase,
      };
      const stateUrl = `/api/storefront/experience/state?merchantSlug=${encodeURIComponent(m.slug)}&buildDigest=${head.buildDigest}&path=${encodeURIComponent(path)}`;
      return {
        manifest: head,
        bootstrap,
        launch,
        stateUrl,
        title: `${m.business_name} · ${route.routeId}`,
        canonicalUrl: canonicalBase + path,
      };
    },
    async state(merchant, build, path = '/') {
      const head = await manifest(merchant);
      const m = await loadMerchant(merchant.id);
      const data = m
        ? await catalog(
            m,
            path.startsWith('/collections/') ? path.split('/')[2] : undefined,
            /^\/(?:products|[^/]+)\/[^/]+$/.test(path) &&
              !path.startsWith('/collections/') &&
              !path.startsWith('/pages/')
              ? path.split('/')[2]
              : undefined
          )
        : null;
      const enrolled =
        !!m &&
        (!head?.capabilities.some(
          (c) => c.startsWith('cart.') || c.startsWith('checkout.')
        ) ||
          merchantHasFeature(m, 'shared_cart'));
      return readPublishedExperienceState({
        head,
        catalog: data,
        enrolled,
        requestedBuild: build,
      });
    },
  };
  return runtime;
}
