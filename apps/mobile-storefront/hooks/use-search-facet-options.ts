import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  type AvailableSearchFacets,
  availableSearchFacetsSchema,
} from '@/schemas/available-search-facets';
import { CONSTANT_MERCHANT_ID } from './product-utils';

export function useSearchFacetOptions(
  query: string,
  enabled: boolean,
  categoryId?: string,
  merchantId: string = CONSTANT_MERCHANT_ID
) {
  return useQuery<AvailableSearchFacets>({
    queryKey: [
      'search-available-facets',
      merchantId,
      query,
      ...(categoryId ? [categoryId] : []),
    ],
    enabled: enabled && !!merchantId,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        categoryId
          ? 'get_storefront_search_category_facets'
          : 'get_storefront_search_available_facets',
        {
          search_query: query,
          merchant_id_param: merchantId,
          ...(categoryId ? { category_id_param: categoryId } : {}),
        }
      );
      const parsed = availableSearchFacetsSchema.safeParse(data);
      if (error || !parsed.success)
        throw new Error('Available filters couldn’t load.');
      return parsed.data;
    },
  });
}
