import { EXPO_PUBLIC_API_URL } from '@/env';
import { captureCartPairingLink } from '@/lib/cart/pairing-link';
import { CONFIG } from '@/lib/config';
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  // The web issuer mints continuation URLs on <slug>.<root domain>
  // (NEXT_PUBLIC_ROOT_DOMAIN); the API origin lives on the api.* host
  // of that same root, so derive the root from it.
  const platformRootDomain = new URL(EXPO_PUBLIC_API_URL).hostname.replace(
    /^api\./,
    ''
  );
  return captureCartPairingLink(path, {
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    merchantDomain: CONFIG.MERCHANT_DOMAIN,
    platformRootDomain,
  });
}
