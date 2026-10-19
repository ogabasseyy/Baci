import type { RegisteredAddress } from '@baci/shared/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  CONSTANT_MERCHANT_ID,
  log,
  MERCHANT_SLUG,
} from '@/hooks/product-utils';
import { withSupabaseRetry } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export interface Merchant {
  id: string;
  slug: string;
  business_name: string;
  social_media: Record<string, string>;
  email?: string;
  phone?: string;
  business_address?: string;
  registered_address?: RegisteredAddress | null;
  hero_image_ids?: string[];
  premium_features?: string[] | null;
}

export function useMerchant() {
  return useQuery<Merchant>({
    queryKey: ['merchant_id', MERCHANT_SLUG, 'premium-features-v3'],
    queryFn: async () => {
      log.info('Resolving ID for slug:', MERCHANT_SLUG);

      const { data, error } = await withSupabaseRetry(
        async () =>
          await supabase
            .from('merchants')
            .select(
              'id, slug, business_name, social_media, email, phone, business_address, registered_address, hero_image_ids, premium_features'
            )
            .eq('slug', MERCHANT_SLUG)
            .single(),
        { maxRetries: 3 }
      );

      if (error) throw error;
      if (!data) throw new Error('Merchant not found');
      return data as Merchant;
    },
    staleTime: 1000 * 60 * 60 * 24,
    placeholderData: {
      id: CONSTANT_MERCHANT_ID,
      slug: MERCHANT_SLUG,
      business_name: 'Store',
      social_media: {},
    } as Merchant,
  });
}
