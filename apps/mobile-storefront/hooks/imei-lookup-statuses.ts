import { supabase } from '@/lib/supabase';

/**
 * Reads `id, status` of one customer's own IMEI checks for one store. RLS
 * (`customer_reads_own_imei_lookups`) already limits rows to the caller;
 * the customer filter is defence in depth.
 */
export const readImeiLookupStatuses =
  (merchantId: string, customerId: string | null) => async (ids: string[]) =>
    customerId
      ? await supabase
          .from('imei_lookups')
          .select('id, status')
          .eq('merchant_id', merchantId)
          .eq('customer_id', customerId)
          .in('id', ids)
          .limit(ids.length)
      : { data: [], error: null };
