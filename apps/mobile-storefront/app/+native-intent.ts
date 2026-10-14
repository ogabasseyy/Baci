import { EXPO_PUBLIC_API_URL } from '@/env';
import { captureCartPairingLink } from '@/lib/cart/pairing-link';
import { CONFIG } from '@/lib/config';
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  return captureCartPairingLink(path, {
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    merchantDomain: CONFIG.MERCHANT_DOMAIN,
    // The configured API origin is the platform root the slug
    // storefront subdomain lives under (web: NEXT_PUBLIC_ROOT_DOMAIN).
    platformRootDomain: new URL(EXPO_PUBLIC_API_URL).hostname,
  });
}
