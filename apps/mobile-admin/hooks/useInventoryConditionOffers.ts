import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useMerchant } from '@/hooks/useMerchant';
import { supabase } from '@/lib/supabase';

const offerSchema = z.object({
  id: z.string().min(1),
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']),
  status: z.enum(['active', 'inactive', 'sold_out']).nullable(),
});
export type InventoryConditionOffer = z.infer<typeof offerSchema>;

export function useInventoryConditionOffers(
  productId: string,
  enabled: boolean
) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;
  return useQuery({
    queryKey: ['inventory-condition-offers', merchantId, productId],
    enabled: enabled && !!merchantId && !!productId,
    queryFn: async (): Promise<InventoryConditionOffer[]> => {
      if (!merchantId) throw new Error('No merchant');
      const { data, error } = await supabase
        .from('product_offers')
        .select('id, condition, status')
        .eq('merchant_id', merchantId)
        .eq('product_id', productId)
        .order('condition');
      if (error) throw new Error(error.message);
      const result = z.array(offerSchema).safeParse(data);
      if (!result.success) throw new Error('Invalid condition offers');
      return result.data;
    },
  });
}
