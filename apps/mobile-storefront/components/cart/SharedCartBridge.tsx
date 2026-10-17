import { useEffect } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { useMerchant } from '@/hooks/use-merchant';
import { useSharedCart } from '@/hooks/use-shared-cart';
import { resolveCartApiOrigin } from '@/lib/cart/api-origin';
import {
  nativeCartAccountsEnabled,
  nativeCartEnabled,
} from '@/lib/cart/enrollment';
import { CONFIG } from '@/lib/config';
import { useAuthStore } from '@/stores/auth-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

export function SharedCartBridge() {
  const { data: merchant, isPlaceholderData } = useMerchant();
  const subjectKey = useAuthStore((state) => state.user?.id ?? 'guest');
  const accountUserId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    useNativeSharedCartStore.setState({ accountUserId });
  }, [accountUserId]);
  useSharedCart({
    enabled:
      !isPlaceholderData &&
      nativeCartEnabled(merchant, {
        merchantId: CONFIG.MERCHANT_ID,
        merchantSlug: CONFIG.MERCHANT_SLUG,
      }),
    accountsEnabled:
      !isPlaceholderData &&
      nativeCartAccountsEnabled(merchant, {
        merchantId: CONFIG.MERCHANT_ID,
        merchantSlug: CONFIG.MERCHANT_SLUG,
      }),
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    apiOrigin: resolveCartApiOrigin(EXPO_PUBLIC_API_URL),
    subjectKey,
  });
  return null;
}
