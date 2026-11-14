import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { z } from 'zod';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import { publicExperienceCatalogSchema } from '@/schemas/experience-catalog';
import { createBoundPublicFetcher } from './public-fetch';

/** Anonymous public catalog reads scoped to the resolved merchant and journey. */
export function createPublicCatalogReader(
  settings: {
    origin: string;
    merchantSlug: string;
    productId: string;
    productSlug: string;
    paths: string[];
  },
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network'
  > = {}
) {
  const origin = productionOrigin(settings.origin);
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(settings.merchantSlug);
  const productId = z.uuid().parse(settings.productId);
  const productSlug = z
    .string()
    .regex(/^[a-z0-9-]{1,240}$/)
    .parse(settings.productSlug);
  if (
    !settings.paths.length ||
    settings.paths.length > 128 ||
    settings.paths.some((path) => normalizeExperiencePath(path) !== path)
  )
    throw Error('INVALID_PUBLIC_ROUTES');
  const selections = new Map<string, 'all' | 'product'>();
  const add = (key?: string, value?: string) => {
    const url = new URL('/api/storefront/experience/catalog', origin);
    url.searchParams.set('merchantSlug', slug);
    if (key && value) url.searchParams.set(key, value);
    selections.set(
      url.href,
      key === 'productId' || key === 'productSlug' ? 'product' : 'all'
    );
  };
  add();
  add('productId', productId);
  add('productSlug', productSlug);
  for (const path of settings.paths) {
    const match = path.match(/^\/collections\/([a-z0-9-]{1,240})$/);
    if (match) add('handle', match[1]);
  }
  const fetchBound = createBoundPublicFetcher({
    origins: [origin],
    urls: [...selections.keys()],
    ...options,
  });
  return async (request: { url: string; method: string; body?: string }) => {
    const selection = selections.get(request.url);
    if (request.method !== 'GET' || request.body !== undefined || !selection)
      throw Error('PUBLIC_CATALOG_REQUEST_DENIED');
    const response = await fetchBound(request.url);
    if (
      response.contentType.split(';', 1)[0].trim().toLowerCase() !==
        'application/json' ||
      response.body.length > EXPERIENCE_LIMITS.jsonResponseBytes
    )
      throw Error('PUBLIC_CATALOG_MISMATCH');
    const catalog = publicExperienceCatalogSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(response.body)
      )
    );
    if (
      selection === 'product' &&
      catalog.products.some(
        (item) => item.id !== productId || item.slug !== productSlug
      )
    )
      throw Error('PUBLIC_CATALOG_MISMATCH');
    return { status: 200, body: JSON.stringify(catalog) };
  };
}
