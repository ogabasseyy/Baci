import 'server-only';
import { getCachedMerchantByDomain } from '@/lib/cached-data';
import {
  getRequestHost,
  isLocalhostIdentifier,
  resolveStorefrontRouteIdentifiers,
} from '@/lib/storefront-host';

export async function getBankCardOfferCallbackOrigin({
  request,
  merchantId,
  merchantSlug,
}: {
  request?: Request;
  merchantId: string;
  merchantSlug: string;
}) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  const local =
    process.env.NODE_ENV !== 'production' &&
    /^localhost(?::\d+)?$/.test(rootDomain);
  const defaultOrigin = `${local ? 'http' : 'https'}://${merchantSlug}.${rootDomain}`;
  if (!request) return defaultOrigin;

  const requestHost = getRequestHost(request);
  if (
    requestHost === rootDomain.toLowerCase() ||
    (!local && requestHost === `www.${rootDomain.toLowerCase()}`)
  ) {
    // Platform path routing keeps the shopper's host-scoped auth cookies.
    return `${local ? 'http' : 'https'}://${requestHost}/${encodeURIComponent(merchantSlug)}`;
  }
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(requestHost) ||
    isLocalhostIdentifier(requestHost) ||
    requestHost === new URL(defaultOrigin).host
  ) {
    return defaultOrigin;
  }

  // Preserve the signed-in shopper's cookie host when the return URL
  // belongs to a verified custom domain of the order's storefront.
  for (const identifier of resolveStorefrontRouteIdentifiers({
    request,
    rootDomain,
  })) {
    if (!identifier.includes('.')) continue;
    try {
      const merchant = await getCachedMerchantByDomain(identifier);
      if (merchant?.id === merchantId) return `https://${requestHost}`;
    } catch {
      return defaultOrigin;
    }
  }
  return defaultOrigin;
}
