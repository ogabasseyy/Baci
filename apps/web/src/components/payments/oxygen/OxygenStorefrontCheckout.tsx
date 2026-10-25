import { notFound } from 'next/navigation';
import { CheckoutStepCard } from '@/components/storefront/ogabassey/pages/checkout/components/CheckoutStepCard';
import { CheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import { readOxygenCustomerPrefill } from '@/lib/payments/oxygen/customer-prefill';
import { createClient } from '@/lib/supabase/server';
import { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';
import { oxygenCustomerPrefillSchema } from '@/schemas/oxygen-customer-prefill';
import { OxygenApplicationDialog } from './OxygenApplicationDialog';
import { OxygenMobileOrderSummary } from './OxygenMobileOrderSummary';

/** Resume the owned, persisted order inside the existing storefront checkout. */
export async function OxygenStorefrontCheckout({
  orderId,
  merchantId,
  merchantSlug,
}: {
  orderId: string;
  merchantId: string;
  merchantSlug: string;
}) {
  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) {
    return (
      <CheckoutPage
        oxygenStep={
          <OxygenApplicationDialog
            orderId={orderId}
            merchantSlug={merchantSlug}
          />
        }
      />
    );
  }
  const { data, error } = await client
    .from('orders')
    .select(
      'id, customer_name, customer_email, currency, subtotal, shipping_fee, tax_amount, total, order_items(id, name, image_url, quantity, price, products:products!order_items_product_id_fkey(images))'
    )
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  const parsed = oxygenCheckoutOrderSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const order = parsed.data;
  const prefill = await readOxygenCustomerPrefill(client, orderId, user.id);
  const names = order.customer_name?.trim().split(/\s+/) ?? [];
  const checkoutContact = oxygenCustomerPrefillSchema.safeParse({
    ...prefill,
    ...(names.length >= 2
      ? { first_name: names[0], last_name: names.slice(1).join(' ') }
      : {}),
    ...(order.customer_email ? { email: order.customer_email } : {}),
  });
  const contact = checkoutContact.success ? checkoutContact.data : prefill;
  const money = (amount: number) =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: order.currency,
    }).format(amount);
  const summary = (
    <section
      aria-label="Saved order summary"
      className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-4 text-lg font-bold text-gray-900">Order Summary</h2>
      <ul className="space-y-3">
        {order.order_items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 text-sm">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span>{money(item.price * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-2 border-t border-gray-100 pt-4 text-sm">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{money(order.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Delivery</dt>
          <dd>{money(order.shipping_fee)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax</dt>
          <dd>{money(order.tax_amount)}</dd>
        </div>
        <div className="flex justify-between text-lg font-bold">
          <dt>Order total</dt>
          <dd>{money(order.total)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-gray-600">
        Your order is saved. Complete your Oxygen payment plan to continue.
      </p>
      <p className="mt-2 text-sm text-gray-600">
        Contact: {order.customer_name} · {order.customer_email}
      </p>
    </section>
  );
  return (
    <CheckoutPage
      oxygenStep={
        <>
          <CheckoutStepCard
            number={1}
            title="Contact Information"
            complete
            summary={`${order.customer_name ?? ''} · ${order.customer_email ?? ''}`}
          />
          <CheckoutStepCard
            number={2}
            title="Delivery Method"
            complete
            summary="Delivery selection saved with this order"
          />
          <CheckoutStepCard number={3} title="Payment Method" active>
            <OxygenApplicationDialog
              orderId={orderId}
              merchantSlug={merchantSlug}
              prefill={contact}
              productAmount={order.total}
              products={order.order_items.map((item) => {
                const product = Array.isArray(item.products)
                  ? item.products[0]
                  : item.products;
                const images = Array.isArray(product?.images)
                  ? product.images
                  : [];
                return {
                  ...item,
                  imageUrl:
                    item.image_url ||
                    images.find(
                      (image): image is string =>
                        typeof image === 'string' && image.trim().length > 0
                    ),
                };
              })}
              currency={order.currency}
            />
          </CheckoutStepCard>
        </>
      }
      oxygenSummary={summary}
      oxygenMobileSummary={<OxygenMobileOrderSummary order={order} />}
    />
  );
}
