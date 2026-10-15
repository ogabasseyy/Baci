import { EXPO_PUBLIC_API_URL, EXPO_PUBLIC_ROOT_DOMAIN } from '@/env';
import { captureCartPairingLink } from '@/lib/cart/pairing-link';
import { CONFIG } from '@/lib/config';
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  // The web issuer mints continuation URLs on <slug>.<root domain>
  // (NEXT_PUBLIC_ROOT_DOMAIN). Prefer the explicit mobile mirror of
  // that value; otherwise derive it from the API origin by stripping
  // a known API host prefix (the bare root host needs no stripping).
  const apiHostname = new URL(EXPO_PUBLIC_API_URL).hostname;
  const platformRootDomain =
    EXPO_PUBLIC_ROOT_DOMAIN ??
    apiHostname.replace(/^(?:api-staging|api)\./, '');
  return captureCartPairingLink(path, {
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    merchantDomain: CONFIG.MERCHANT_DOMAIN,
    platformRootDomain,
  });
}
