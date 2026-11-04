'use client';
import type { z } from 'zod';
import { MobileOrderSummary } from '@/components/storefront/ogabassey/components/MobileCheckoutComponents';
import type { CartItem } from '@/hooks/cart';
import type { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';

/** The actual checkout's mobile summary, populated from the saved order. */
export function OxygenMobileOrderSummary({
  order,
}: {
  order: z.infer<typeof oxygenCheckoutOrderSchema>;
}) {
  const cart: CartItem[] = order.order_items.map((item) => ({
    id: item.id,
    cartItemId: item.id,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    image: '/placeholder.svg',
    imageLarge: '/placeholder.svg',
    imageHint: item.name,
    brand: '',
    description: '',
    gtin: '',
    mpn: '',
    manage_stock: false,
    status: 'active',
    stock: item.quantity,
  }));
  return (
    <MobileOrderSummary
      cart={cart}
      cartTotal={order.subtotal}
      deliveryCost={order.shipping_fee}
      deliveryMethod={null}
      giftWrappingCost={0}
      walletBalance={0}
      payWithWallet={false}
      walletAmountUsed={0}
      remainingAmount={order.total}
    />
  );
}
