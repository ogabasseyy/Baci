import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { PLATFORM_ROOT_ROUTE_SEGMENTS } from './routing-constants';

/** External storefront paths that can render the Oxygen payment journey. */
export function isStorefrontCheckoutPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1) return segments[0] === 'checkout';
  if (segments.length !== 2 || segments[1] !== 'checkout') return false;
  const slug = segments[0].toLowerCase();
  return (
    !storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(slug) &&
    !PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug) &&
    !['product', 'categories'].includes(slug)
  );
}

export function isOxygenPaymentSurface(pathname: string): boolean {
  return (
    isStorefrontCheckoutPath(pathname) ||
    /^\/payments\/oxygen\/[^/]+\/?$/.test(pathname)
  );
}
