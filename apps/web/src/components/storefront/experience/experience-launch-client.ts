import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { fetchWithCsrf } from '@/lib/api-client';
import { publicExperienceCatalogSchema } from '@/schemas/experience-catalog';
import {
  experienceLaunchRenewalSchema,
  experiencePublicationStateSchema,
} from '@/schemas/experience-public-request';

/** Exact same-origin read; Referer keeps root-host merchant hints constrained. */
export async function readExperiencePublicationState(url: string) {
  const target = new URL(url, location.origin);
  if (
    target.origin !== location.origin ||
    target.pathname !== '/api/storefront/experience/state'
  )
    throw Error('INVALID_STATE_URL');
  const response = await fetch(target, {
    cache: 'no-store',
    credentials: 'same-origin',
    referrerPolicy: 'same-origin',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('STATE_UNAVAILABLE');
  const text = await response.text();
  if (text.length > 4096) throw Error('STATE_BUDGET');
  return experiencePublicationStateSchema.parse(JSON.parse(text));
}

export async function renewExperienceLaunch(stateUrl: string) {
  const target = new URL(stateUrl, location.origin);
  if (
    target.origin !== location.origin ||
    target.pathname !== '/api/storefront/experience/state'
  )
    throw Error('INVALID_STATE_URL');
  const body = {
    buildDigest: target.searchParams.get('buildDigest'),
    path: target.searchParams.get('path') ?? '/',
  };
  target.pathname = '/api/storefront/experience/launch';
  const response = await fetchWithCsrf(target.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    referrerPolicy: 'same-origin',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('LAUNCH_UNAVAILABLE');
  const text = await response.text();
  if (text.length > 4096) throw Error('LAUNCH_BUDGET');
  return experienceLaunchRenewalSchema.parse(JSON.parse(text));
}

export async function readExperienceCatalog(
  stateUrl: string,
  selection: { handle?: string; productSlug?: string; productId?: string }
) {
  const url = new URL(stateUrl, location.origin);
  if (
    url.origin !== location.origin ||
    url.pathname !== '/api/storefront/experience/state'
  )
    throw Error('INVALID_STATE_URL');
  const slug = url.searchParams.get('merchantSlug');
  url.pathname = '/api/storefront/experience/catalog';
  url.search = '';
  if (slug) url.searchParams.set('merchantSlug', slug);
  for (const [k, v] of Object.entries(selection))
    if (v) url.searchParams.set(k, v);
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    referrerPolicy: 'same-origin',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('CATALOG_UNAVAILABLE');
  const text = await response.text();
  if (
    new TextEncoder().encode(text).byteLength >
    EXPERIENCE_LIMITS.jsonResponseBytes
  )
    throw Error('CATALOG_BUDGET');
  return publicExperienceCatalogSchema.parse(JSON.parse(text));
}
