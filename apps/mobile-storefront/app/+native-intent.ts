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
  });
}
