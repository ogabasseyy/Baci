import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { MerchantReceiptInfoSchema } from '@/schemas/receipt';
import type { MerchantReceiptInfo } from '@/types/receipt';

const log = createLogger('Receipts');
const MERCHANT_SLUG = CONFIG.MERCHANT_SLUG || 'ogabassey';

function normalizeLegacyBrandColors(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const brandColors = (data as Record<string, unknown>).brand_colors;
  if (
    brandColors === null ||
    typeof brandColors !== 'object' ||
    Array.isArray(brandColors)
  ) {
    return data;
  }
  const colors = brandColors as Record<string, unknown>;
  if (colors.accent !== undefined || colors.primary === undefined) {
    return data;
  }
  return {
    ...(data as Record<string, unknown>),
    brand_colors: { ...colors, accent: colors.primary },
  };
}

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

      // Legacy merchant rows may store brand_colors with only `primary`
      // (the JSONB column is unconstrained). The renderer falls back to
      // the primary color when `accent` is absent, so normalize the
      // legacy shape before validating instead of failing the query.
      const result = MerchantReceiptInfoSchema.safeParse(
        normalizeLegacyBrandColors(data)
      );
      if (!result.success) {
        log.warn(
          'Merchant receipt info validation warning:',
          result.error.message
        );
        throw result.error;
      }

      return result.data;
    },
    staleTime: 1000 * 60 * 60,
    networkMode: 'always',
    retry: false,
  });
}
