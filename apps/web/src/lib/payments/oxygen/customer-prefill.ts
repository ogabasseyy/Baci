import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  type OxygenCustomerPrefill,
  oxygenCustomerPrefillSchema,
} from '@/schemas/oxygen-customer-prefill';

const orderSchema = z.object({
  customer_id: z.string(),
  merchant_id: z.string(),
  customer_email: z.string().nullable().optional(),
});

/** Normal caller client under RLS; customer ID, merchant and auth user must all match.
 * This is contact/profile reuse, not proof of Oxygen or another provider's KYC. */
export async function readOxygenCustomerPrefill(
  client: SupabaseClient,
  orderId: string,
  userId: string
): Promise<OxygenCustomerPrefill> {
  const orderResult = await client
    .from('orders')
    .select('customer_id, merchant_id, customer_email')
    .eq('id', orderId)
    .maybeSingle();
  const order = orderSchema.safeParse(orderResult.data);
  if (orderResult.error || !order.success) return {};
  const result = await client
    .from('customers')
    .select('first_name, last_name, email, date_of_birth')
    .eq('id', order.data.customer_id)
    .eq('merchant_id', order.data.merchant_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error || !result.data || typeof result.data !== 'object')
    return {};
  const source = result.data as Record<string, unknown>;
  const prefill: OxygenCustomerPrefill = {};
  for (const key of [
    'first_name',
    'last_name',
    'email',
    'date_of_birth',
  ] as const) {
    const parsed = oxygenCustomerPrefillSchema.shape[key].safeParse(
      source[key]
    );
    if (parsed.success && parsed.data) prefill[key] = parsed.data;
  }
  if (!prefill.email) {
    const email = oxygenCustomerPrefillSchema.shape.email.safeParse(
      order.data.customer_email
    );
    if (email.success && email.data) prefill.email = email.data;
  }
  return prefill;
}
