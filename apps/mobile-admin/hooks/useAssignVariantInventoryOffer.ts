import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { supabase } from '@/lib/supabase';
import {
  invalidateVariantInventoryQueries,
  toInventoryMutationError,
} from './useVariantInventoryInvalidation';

export interface AssignVariantInventoryOfferVariables {
  productId: string;
  unitId: string;
  offerId: string | null;
}

export function useAssignVariantInventoryOffer() {
  const queryClient = useQueryClient();
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;

  return useMutation<unknown, Error, AssignVariantInventoryOfferVariables>({
    mutationFn: async ({ unitId, offerId }) => {
      if (!merchantId) throw new Error('No merchant');
      const { data, error } = await supabase.rpc(
        'assign_variant_inventory_unit_offer',
        {
          p_merchant_id: merchantId,
          p_unit_id: unitId,
          p_offer_id: offerId,
        }
      );
      if (error) throw toInventoryMutationError(error);
      return data;
    },
    onSuccess: (_data, variables) => {
      invalidateVariantInventoryQueries(
        queryClient,
        merchantId,
        variables.productId
      );
    },
  });
}
