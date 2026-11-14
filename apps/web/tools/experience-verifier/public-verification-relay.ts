import { z } from 'zod';
import { productionOrigin } from '@/lib/experience/production-origins';
import { experienceLaunchRenewalSchema } from '@/schemas/experience-public-request';
import { createPublicCartNetwork } from './public-cart-network';
import { createPublicCartSession } from './public-cart-session';
import { createPublicCommerceRelay } from './public-commerce-relay';
import { createPublicFrameworkReader } from './public-framework-reader';
import { publicFrameworkRequest } from './public-framework-request';
import { createPublicProductNetwork } from './public-product-network';
import { createPublicCatalogReader } from './public-verification-catalog';
import { createPublicStateReader } from './public-verification-state';

/** Verifier-only composition from an owner-bound receipt and RLS-derived plan. */
export function createPublicVerificationRelay(
  input: {
    binding: {
      merchantId: string;
      slug: string;
      canonicalBase: string;
      buildDigest: string;
      head: { policyRevision: string };
    };
    product: { id: string; slug: string; variantId?: string };
    supabase: { url: string; anonKey: string };
    paths: string[];
  },
  deps: {
    makeCartNetwork: typeof createPublicCartNetwork;
    makeProductNetwork: typeof createPublicProductNetwork;
    makeStateReader: typeof createPublicStateReader;
    makeCatalogReader: typeof createPublicCatalogReader;
    makeFrameworkReader?: typeof createPublicFrameworkReader;
  } = {
    makeCartNetwork: createPublicCartNetwork,
    makeProductNetwork: createPublicProductNetwork,
    makeStateReader: createPublicStateReader,
    makeCatalogReader: createPublicCatalogReader,
  }
) {
  const merchantId = z.uuid().parse(input.binding.merchantId);
  const merchantSlug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(input.binding.slug);
  const productId = z.uuid().parse(input.product.id);
  const variantId =
    input.product.variantId === undefined
      ? undefined
      : z.uuid().parse(input.product.variantId);
  const origin = productionOrigin(input.binding.canonicalBase);
  const productOrigin = productionOrigin(input.supabase.url);
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(input.supabase.anonKey))
    throw Error('INVALID_PUBLIC_CLIENT');
  const cartConfig = {
    origin,
    merchantSlug,
    productId,
    launch: { buildDigest: input.binding.buildDigest, paths: input.paths },
    ...(variantId ? { variantId } : {}),
  };
  const cart = createPublicCartSession({
    ...cartConfig,
    merchantId,
    network: deps.makeCartNetwork(cartConfig),
  });
  const product = { origin: productOrigin, merchantId, productId };
  const readProduct = deps.makeProductNetwork({
    ...product,
    publishableKey: input.supabase.anonKey,
  });
  const commerce = createPublicCommerceRelay({ product, cart, readProduct });
  const readState = deps.makeStateReader(
    {
      canonicalBase: origin,
      slug: merchantSlug,
      buildDigest: input.binding.buildDigest,
      policyRevision: input.binding.head.policyRevision,
    },
    input.paths
  );
  const readCatalog = deps.makeCatalogReader({
    origin,
    merchantSlug,
    productId,
    productSlug: input.product.slug,
    paths: input.paths,
  });
  const readFramework = (
    deps.makeFrameworkReader ?? createPublicFrameworkReader
  )(origin);
  return async (request: Parameters<typeof commerce>[0]) => {
    const path = new URL(request.url).pathname;
    if (publicFrameworkRequest(origin, request)) return readFramework(request);
    if (path === '/api/storefront/experience/state') return readState(request);
    if (path === '/api/storefront/experience/catalog')
      return readCatalog(request);
    const result = await commerce(request);
    if (path === '/api/storefront/experience/launch') {
      try {
        if (Buffer.byteLength(result.body) > 4096) throw Error();
        const renewal = experienceLaunchRenewalSchema.parse(
          JSON.parse(result.body)
        );
        const now = Date.now();
        if (
          renewal.buildDigest !== input.binding.buildDigest ||
          renewal.policyRevision !== input.binding.head.policyRevision ||
          renewal.expiresAt <= now ||
          renewal.expiresAt > now + 3600000
        )
          throw Error();
      } catch {
        throw Error('PUBLIC_LAUNCH_MISMATCH');
      }
    }
    return result;
  };
}
