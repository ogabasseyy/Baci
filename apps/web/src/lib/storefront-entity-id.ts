import { sanitizeSchemaUrl } from './sanitize-json-ld';

export function normalizeStorefrontBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function buildStorefrontEntityId(
  baseUrl: string,
  fragment: string
): string {
  const normalizedBase = normalizeStorefrontBaseUrl(baseUrl);
  const normalizedFragment = fragment.replace(/^#+/, '');
  return `${normalizedBase}/#${normalizedFragment}`;
}

export function tryParseUrl(url: string | undefined | null): URL | undefined {
  if (!url) {
    return undefined;
  }

  const sanitizedUrl = sanitizeSchemaUrl(url);
  if (!sanitizedUrl) {
    return undefined;
  }

  try {
    return new URL(sanitizedUrl);
  } catch {
    return undefined;
  }
}

export function buildProductSchemaEntityIdentity(
  productUrl: URL | undefined
): { '@id': string; url: string } | Record<string, never> {
  if (!productUrl) {
    return {};
  }

  const normalizedProductUrl = productUrl.toString();
  return {
    '@id': `${normalizeStorefrontBaseUrl(normalizedProductUrl)}#product`,
    url: normalizedProductUrl,
  };
}

export function buildOfferSellerEntity(
  merchantName: string,
  merchantBaseUrl?: string
): { '@type': 'Organization'; '@id'?: string; name: string } {
  const validMerchantBaseUrl = tryParseUrl(merchantBaseUrl);
  const sellerEntityId = validMerchantBaseUrl
    ? buildStorefrontEntityId(validMerchantBaseUrl.toString(), 'online-store')
    : undefined;

  return {
    '@type': 'Organization',
    ...(sellerEntityId && { '@id': sellerEntityId }),
    name: merchantName,
  };
}

export function applyOfferSellerEntity(
  offers: unknown,
  seller: { '@type': 'Organization'; '@id'?: string; name: string }
): unknown {
  if (Array.isArray(offers)) {
    return offers.map((offer) =>
      offer && typeof offer === 'object' && !Array.isArray(offer)
        ? { ...(offer as Record<string, unknown>), seller }
        : offer
    );
  }

  if (offers && typeof offers === 'object') {
    return { ...(offers as Record<string, unknown>), seller };
  }

  return offers;
}

export function buildCollectionPageEntityIdentity(
  absolutePageUrl: string
): { '@id': string; url: string } | Record<string, never> {
  if (!absolutePageUrl) {
    return {};
  }

  return {
    '@id': `${normalizeStorefrontBaseUrl(absolutePageUrl)}#collection`,
    url: absolutePageUrl,
  };
}
