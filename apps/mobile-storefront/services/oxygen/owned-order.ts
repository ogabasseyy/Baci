import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { oxygenOrderPrefill } from './order-prefill';

const orderSchema = z.object({
  id: z.uuid(),
  order_number: z.string().nullish(),
  total: z.coerce.number().positive(),
  payment_method: z.string(),
  payment_status: z.string(),
  shipping_status: z.string(),
  customer_email: z.unknown().optional(),
  shipping_address: z.unknown().optional(),
  delivery_method: z.unknown().optional(),
});
export async function readOwnedOxygenOrder(
  orderId: string,
  customerId: string,
  merchantId: string
) {
  z.uuid().parse(orderId);
  z.uuid().parse(customerId);
  z.uuid().parse(merchantId);
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id,order_number,total,payment_method,payment_status,shipping_status,customer_email,shipping_address,delivery_method'
    )
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .single();
  if (error)
    throw new Error(
      'Your saved order is unavailable. Check your staging account and connection.'
    );
  const order = orderSchema.parse(data);
  if (order.payment_method !== 'oxygen')
    throw new Error(
      'This order uses another payment method. Open it from your order history.'
    );
  if (
    ['cancelled', 'returned', 'refunded'].includes(order.shipping_status) ||
    order.payment_status === 'refunded'
  )
    throw new Error(
      'This order is closed. Open your order history for details.'
    );
  return { ...order, prefill: oxygenOrderPrefill(order) };
}
