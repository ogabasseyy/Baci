import { supabase } from '@/lib/supabase';

/** Reads `id, status` of the customer's own IMEI checks for one store. */
export const readImeiLookupStatuses =
  (merchantId: string) => async (ids: string[]) =>
    await supabase
      .from('imei_lookups')
      .select('id, status')
      .eq('merchant_id', merchantId)
      .in('id', ids)
      .limit(ids.length);
