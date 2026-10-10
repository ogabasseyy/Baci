import { CONFIG } from '@/lib/config';

type NativeAssurancePolicy = {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
};

export function nativeAssurancePolicy(): NativeAssurancePolicy {
  return {
    smartCartProEnabled: CONFIG.ENABLE_SMART_CART_PRO,
    merchantSlug: CONFIG.MERCHANT_SLUG,
  };
}
