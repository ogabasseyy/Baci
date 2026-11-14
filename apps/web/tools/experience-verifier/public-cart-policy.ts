import { z } from 'zod';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';

/** Request validation only: the relay must independently isolate the browser,
 * pin DNS, bound traffic, and hold its own anonymous session and CSRF state. */
export function createPublicCartPolicy(settings: {
  origin: string;
  merchantSlug: string;
  productId: string;
  variantId?: string;
  launch?: { buildDigest: string; paths: string[] };
}) {
  const origin = productionOrigin(settings.origin);
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(settings.merchantSlug);
  const productId = z.uuid().parse(settings.productId);
  const variantId =
    settings.variantId === undefined
      ? undefined
      : z.uuid().parse(settings.variantId);
  const identity = z.strictObject({
    productId: z.literal(productId),
    ...(variantId ? { variantId: z.literal(variantId) } : {}),
  });
  const line = z.strictObject({ item: identity, quantity: z.literal(1) });
  const operationId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/);
  const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
  const create = z.strictObject({
    operationId,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    lines: z.array(line).max(1).optional(),
  });
  const command = z.strictObject({
    operationId,
    expectedVersion: version,
    command: z.strictObject({
      type: z.literal('add'),
      item: identity,
      quantity: z.literal(1),
    }),
  });
  const review = z.strictObject({
    operationId,
    expectedVersion: version,
    cartId: z.uuid(),
  });
  const bootstrap = z.strictObject({
    merchantSlug: z.literal(slug).optional(),
  });
  const launch =
    settings.launch &&
    (() => {
      const build = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(settings.launch.buildDigest);
      if (!settings.launch.paths.length || settings.launch.paths.length > 128)
        throw Error('INVALID_PUBLIC_ROUTES');
      const urls = new Map<string, string>();
      for (const path of settings.launch.paths) {
        if (
          normalizeExperiencePath(path) !== path ||
          [...urls.values()].includes(path)
        )
          throw Error('INVALID_PUBLIC_ROUTES');
        const url = new URL('/api/storefront/experience/launch', origin);
        url.searchParams.set('merchantSlug', slug);
        url.searchParams.set('buildDigest', build);
        url.searchParams.set('path', path);
        urls.set(url.href, path);
      }
      return { build, urls };
    })();

  return (input: { url: string; method: string; body?: string }) => {
    try {
      if (
        input.url.length > 2048 ||
        (input.body !== undefined && Buffer.byteLength(input.body) > 8192)
      )
        return false;
      const url = new URL(input.url);
      if (
        url.href !== input.url ||
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.hash
      )
        return false;
      const query = [...url.searchParams.entries()];
      if (url.pathname === '/api/storefront/experience/launch') {
        if (!launch || input.method !== 'POST' || input.body === undefined)
          return false;
        const path = launch.urls.get(url.href);
        return (
          path !== undefined &&
          z
            .strictObject({
              buildDigest: z.literal(launch.build),
              path: z.literal(path),
            })
            .safeParse(JSON.parse(input.body)).success
        );
      }
      if (
        query.length > 1 ||
        (query.length === 1 &&
          (query[0][0] !== 'merchantSlug' || query[0][1] !== slug))
      )
        return false;
      if (input.method === 'GET')
        return (
          input.body === undefined &&
          ((url.pathname === '/api/csrf' && query.length === 0) ||
            url.pathname === '/api/storefront/cart' ||
            url.pathname === '/api/storefront/cart/continuity')
        );
      if (input.method !== 'POST' || input.body === undefined) return false;
      const body: unknown = JSON.parse(input.body);
      if (url.pathname === '/api/storefront/cart/bootstrap')
        return query.length === 0 && bootstrap.safeParse(body).success;
      if (url.pathname === '/api/storefront/cart')
        return create.safeParse(body).success;
      if (url.pathname === '/api/storefront/cart/commands')
        return command.safeParse(body).success;
      if (url.pathname === '/api/storefront/cart/checkout')
        return review.safeParse(body).success;
      return false;
    } catch {
      return false;
    }
  };
}
