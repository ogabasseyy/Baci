import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { PLATFORM_ROOT_ROUTE_SEGMENTS } from './routing-constants';

// Matches z.uuid() in OxygenPaymentContent without adding Zod to proxy bundles.
const OXYGEN_ORDER_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

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

export function isOxygenPaymentSurface(
  pathname: string,
  searchParams?: URLSearchParams
): boolean {
  const payment = /^\/payments\/oxygen\/([^/]+)\/?$/.exec(pathname);
  const orderIds = searchParams?.getAll('oxygenOrderId') ?? [];
  return (
    (isStorefrontCheckoutPath(pathname) &&
      orderIds.length === 1 &&
      OXYGEN_ORDER_ID.test(orderIds[0])) ||
    (payment !== null && OXYGEN_ORDER_ID.test(payment[1]))
  );
}
