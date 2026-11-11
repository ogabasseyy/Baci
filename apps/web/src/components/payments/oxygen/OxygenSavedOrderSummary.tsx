import { ShoppingBag } from 'lucide-react';
import type { z } from 'zod';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';
import { oxygenOrderItemImage } from './oxygen-order-item-image';

export function OxygenSavedOrderSummary({
  order,
}: {
  order: z.infer<typeof oxygenCheckoutOrderSchema>;
}) {
  const money = (amount: number) =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: order.currency,
    }).format(amount);
  return (
    <section
      aria-label="Saved order summary"
      className="rounded-2xl border border-store-background-text/10 bg-store-background p-6 shadow-sm text-store-background-text"
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full bg-store-primary/10 text-store-primary"
        >
          <ShoppingBag size={13} />
        </span>
        Order Summary
      </h2>
      <ul className="space-y-4">
        {order.order_items.map((item) => (
          <li key={item.id} className="flex gap-3 text-sm">
            <div className="ogabassey-product-card-image-surface relative size-12 shrink-0 rounded-lg border border-store-background-text/10 p-1">
              <CdnFormatImage
                src={oxygenOrderItemImage(item)}
                alt={item.name}
                fill
                sizes="48px"
                className="object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{item.name}</p>
              <p className="text-store-background-text/60">
                Qty: {item.quantity}
              </p>
            </div>
            <span className="shrink-0 font-semibold">
              {money(item.price * item.quantity)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-2 border-t border-store-background-text/10 pt-4 text-sm">
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
    </section>
  );
}
