import { z } from 'zod';

const IPV4_OR_IPV6_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])$/;

function hasCleanDnsHostname(hostname: string): boolean {
  return (
    hostname.length > 0 &&
    !hostname.startsWith('.') &&
    !hostname.endsWith('.') &&
    !hostname.includes('..')
  );
}

export const httpsOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        parsed.port === '' &&
        parsed.origin === raw &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        hasCleanDnsHostname(parsed.hostname) &&
        parsed.hostname.includes('.') &&
        !IPV4_OR_IPV6_HOST.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, 'CSP allowlist entry must be a bare HTTPS hostname origin without wildcards or raw IPs');

export const previewOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      if (
        parsed.origin !== raw ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.pathname !== '/' ||
        parsed.search !== '' ||
        parsed.hash !== '' ||
        !hasCleanDnsHostname(parsed.hostname)
      ) {
        return false;
      }
      if (
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      ) {
        return true;
      }
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'localhost' ||
          (parsed.hostname.includes('.') &&
            !IPV4_OR_IPV6_HOST.test(parsed.hostname)))
      );
    } catch {
      return false;
    }
  }, 'previewOrigin must be a valid HTTPS origin or localhost HTTP origin');

export const NON_PRODUCT_IDENTIFIER_PARAMS: ReadonlySet<string> = new Set([
  'variant',
  'variantId',
  'category',
  'categoryId',
  'categorySlug',
  'collection',
  'collectionId',
  'collectionSlug',
  'brand',
  'condition',
  'filter',
  'page',
]);

const EXPLICIT_PRODUCT_ID_PARAMS: ReadonlySet<string> = new Set(
  'productSlug|product|itemSlug|productId|sku|slug|handle'.split('|')
);

const RECOGNIZED_PRODUCT_QUALIFIER_PARAMS: ReadonlySet<string> = new Set(
  'category|categoryId|categorySlug|collection|collectionId|collectionSlug|brand|condition|variant|variantId|slug|handle|productSlug|product|itemSlug|productId|sku'.split(
    '|'
  )
);

export function isValidProductRouteParams(
  paramList: readonly string[]
): boolean {
  if (!paramList.some((p) => !NON_PRODUCT_IDENTIFIER_PARAMS.has(p))) {
    return false;
  }
  if (paramList.length < 2) return true;
  let explicitIdx = -1;
  for (let i = paramList.length - 1; i >= 0; i--) {
    const p = paramList[i];
    if (p && EXPLICIT_PRODUCT_ID_PARAMS.has(p)) {
      explicitIdx = i;
      break;
    }
  }
  let fallbackIdx = -1;
  for (let i = paramList.length - 1; i >= 0; i--) {
    const p = paramList[i];
    if (p && !NON_PRODUCT_IDENTIFIER_PARAMS.has(p)) {
      fallbackIdx = i;
      break;
    }
  }
  const primaryIdx = explicitIdx >= 0 ? explicitIdx : fallbackIdx;
  const primary = paramList[primaryIdx];
  if (!primary || NON_PRODUCT_IDENTIFIER_PARAMS.has(primary)) return false;
  return paramList.every(
    (p, idx) => idx === primaryIdx || RECOGNIZED_PRODUCT_QUALIFIER_PARAMS.has(p)
  );
}

export const hostOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        parsed.port === '' &&
        parsed.origin === raw &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        hasCleanDnsHostname(parsed.hostname) &&
        parsed.hostname.includes('.') &&
        parsed.hostname !== 'usebaci.com' &&
        parsed.hostname !== 'api.usebaci.com' &&
        parsed.hostname !== 'cdn.usebaci.com' &&
        !IPV4_OR_IPV6_HOST.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, 'hostOrigin must be a bare HTTPS storefront origin without wildcards, ports, platform-reserved hosts, or raw IPs');

export const cspAllowlistSchema = z
  .strictObject({
    scriptOrigins: z.array(httpsOriginSchema).max(16).default([]),
    connectOrigins: z.array(httpsOriginSchema).max(16).default([]),
    imgOrigins: z.array(httpsOriginSchema).max(16).default([]),
  })
  .default({
    scriptOrigins: [],
    connectOrigins: [],
    imgOrigins: [],
  });

export type CspAllowlist = z.infer<typeof cspAllowlistSchema>;
