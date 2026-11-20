import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { OxygenClientError } from './errors';

export async function findOwnedOxygenWorkflowId(
  orderId: string,
  customerId: string,
  merchantId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('oxygen_workflows')
    .select('id')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('environment', 'production')
    .maybeSingle();
  if (error) throw new OxygenClientError('transport');
  return data ? z.uuid().parse(data.id) : null;
}
