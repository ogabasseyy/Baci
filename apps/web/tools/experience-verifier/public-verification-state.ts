import { z } from 'zod';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import { experiencePublicationStateSchema } from '@/schemas/experience-public-request';
import { createBoundPublicFetcher } from './public-fetch';

/** Anonymous state reads only for the head and routes already resolved by RLS. */
export function createPublicStateReader(
  binding: {
    canonicalBase: string;
    slug: string;
    buildDigest: string;
    policyRevision: string;
  },
  paths: string[],
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network'
  > = {}
) {
  const origin = productionOrigin(binding.canonicalBase);
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(binding.slug);
  const build = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(binding.buildDigest);
  const revision = z.string().min(1).max(128).parse(binding.policyRevision);
  if (!paths.length || paths.length > 128) throw Error('INVALID_PUBLIC_ROUTES');
  const allowed = new Set<string>();
  for (const path of paths) {
    if (normalizeExperiencePath(path) !== path || allowed.has(path))
      throw Error('INVALID_PUBLIC_ROUTES');
    allowed.add(path);
  }
  const urls = paths.map((path) => {
    const url = new URL('/api/storefront/experience/state', origin);
    url.searchParams.set('merchantSlug', slug);
    url.searchParams.set('buildDigest', build);
    url.searchParams.set('path', path);
    return url.href;
  });
  const fetchBound = createBoundPublicFetcher({
    origins: [origin],
    urls,
    ...options,
  });
  return async (request: { url: string; method: string; body?: string }) => {
    if (
      request.method !== 'GET' ||
      request.body !== undefined ||
      !urls.includes(request.url)
    )
      throw Error('PUBLIC_STATE_REQUEST_DENIED');
    const response = await fetchBound(request.url);
    if (
      response.contentType.split(';', 1)[0].trim().toLowerCase() !==
        'application/json' ||
      response.body.length > 4096
    )
      throw Error('PUBLIC_STATE_MISMATCH');
    const state = experiencePublicationStateSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(response.body)
      )
    );
    if (
      !state.active ||
      state.status !== 'active' ||
      state.buildDigest !== build ||
      state.policyRevision !== revision
    )
      throw Error('PUBLIC_STATE_MISMATCH');
    return { status: 200, body: JSON.stringify(state) };
  };
}
