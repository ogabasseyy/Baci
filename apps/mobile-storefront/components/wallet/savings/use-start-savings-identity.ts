import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';

export function useStartSavingsIdentity() {
  const { merchantId, userId } = useAuthStore(
    useShallow((state) => ({
      merchantId: state.merchantId,
      userId: state.user?.id,
    }))
  );
  return {
    userId,
    activeMerchantId: pickMerchantId(merchantId, CONFIG.MERCHANT_ID),
    activeMerchantSlug: CONFIG.MERCHANT_SLUG?.trim() || undefined,
  };
}
