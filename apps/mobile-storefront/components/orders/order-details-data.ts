import type { OrderDetailsInsurancePolicy } from '@/components/orders/OrderDetailsInsuranceCard';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { OrderDetails, RawOrderDetails } from './OrderDetailsScreen.types';
import { mapOrderDetails } from './order-details.helpers';

const log = createLogger('OrderDetailsData');

/**
 * Authoritative customer-facing can-cancel gate.
 *
 * The mobile controller cannot read `transactions` (RLS merchant-only), so it
 * derives can-cancel from this RPC rather than a client-side transaction check.
 * Returns `false` on any RPC error so the CTA fails closed.
 */
export async function fetchOrderCanCancel(orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('customer_order_can_cancel', {
    p_order_id: orderId,
  });
  if (error) {
    log.warn('customer_order_can_cancel RPC failed:', error);
    return false;
  }
  return data === true;
}

export async function fetchOrderRecord(
  orderId: string,
  customerId: string
): Promise<OrderDetails> {
  const { data, error: fetchError } = await supabase
    .from('orders')
    .select(`
      id,
      customer_id,
      merchant_id,
      order_number,
      shipping_status,
      subtotal,
      shipping_fee,
      tax_amount,
      discount_amount,
      total,
      payment_method,
      payment_status,
      created_at,
      updated_at,
      shipping_address,
      tracking_number,
      shipping_provider,
      notes,
      order_items (
        id,
        product_id,
        name,
        quantity,
        price,
        condition,
        variant_name,
        has_assurance,
        assurance_fee,
        products (
          slug,
          images
        )
      )
    `)
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .single();

  if (fetchError) throw fetchError;
  return mapOrderDetails(data as RawOrderDetails);
}

export async function fetchLatestInsurancePolicy(
  orderId: string
): Promise<OrderDetailsInsurancePolicy | null> {
  const { data: policies, error: policyError } = await supabase
    .from('order_insurance_policies')
    .select(
      'mycover_policy_number, coverage_amount, premium_amount, status, claim_status, claim_stage, claim_progress, claim_comment, policy_start_date, policy_expiry_date, certificate_url, provider_name, policy_type, claim_link, inspection_link, inspection_status, created_at'
    )
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (policyError) {
    log.warn('Error fetching order insurance policy:', policyError);
    return null;
  }
  return policies && policies.length > 0
    ? (policies[0] as OrderDetailsInsurancePolicy)
    : null;
}
