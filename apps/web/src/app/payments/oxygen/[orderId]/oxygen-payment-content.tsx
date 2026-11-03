import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
/** The API proves customer/order ownership on every read and mutation. No tokens in URLs. */
export async function OxygenPaymentContent({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (!error && user) {
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('merchant_id, customers!orders_customer_id_fkey1!inner(user_id)')
      .eq('id', orderId)
      .eq('customers.user_id', user.id)
      .maybeSingle();
    if (orderError || !order) notFound();
    const { data: merchant, error: merchantError } = await client
      .from('merchants')
      .select('slug')
      .eq('id', order.merchant_id)
      .maybeSingle();
    if (merchantError || !merchant?.slug) notFound();
    redirect(
      `/${encodeURIComponent(merchant.slug)}/checkout?oxygenOrderId=${orderId}`
    );
  }
  return (
    <p className="text-sm leading-relaxed text-gray-600">
      Open this application from your store’s checkout to sign in and continue.
    </p>
  );
}
