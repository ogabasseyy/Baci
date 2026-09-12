import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { MerchantReceiptInfoSchema } from '@/schemas/receipt';
import type { MerchantReceiptInfo } from '@/types/receipt';

const log = createLogger('Receipts');
const MERCHANT_SLUG = CONFIG.MERCHANT_SLUG || 'ogabassey';

export function useMerchantReceiptInfo() {
  return useQuery<MerchantReceiptInfo>({
    queryKey: ['merchant_receipt_info', MERCHANT_SLUG],
    queryFn: async () => {
      log.info('Fetching merchant receipt info for:', MERCHANT_SLUG);

      const { data, error } = await withSupabaseRetry(
        async () =>
          await supabase
            .rpc('get_storefront_receipt_merchant_info', {
              p_slug: MERCHANT_SLUG,
            })
            .maybeSingle(),
        { maxRetries: 3 }
      );

      if (error) throw error;
      if (!data) throw new Error('Merchant not found');

      const result = MerchantReceiptInfoSchema.safeParse(data);
      if (!result.success) {
        log.warn(
          'Merchant receipt info validation warning:',
          result.error.message
        );
      }

      return data as MerchantReceiptInfo;
    },
    staleTime: 1000 * 60 * 60,
    networkMode: 'always',
    retry: false,
  });
}
