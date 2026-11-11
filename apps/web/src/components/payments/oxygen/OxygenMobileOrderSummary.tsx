'use client';
import type { z } from 'zod';
import { MobileOrderSummary } from '@/components/storefront/ogabassey/components/MobileCheckoutComponents';
import type { CartItem } from '@/hooks/cart';
import { roundMoney } from '@/lib/order-wallet-funding-utils';
import type { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';
import { oxygenOrderItemImage } from './oxygen-order-item-image';

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
    image: oxygenOrderItemImage(item),
    imageLarge: oxygenOrderItemImage(item),
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
      currency={order.currency}
      cart={cart}
      cartTotal={order.subtotal}
      deliveryCost={order.shipping_fee}
      deliveryMethod={null}
      giftWrappingCost={0}
      walletBalance={0}
      payWithWallet={order.wallet_amount_used > 0}
      walletAmountUsed={order.wallet_amount_used}
      remainingAmount={roundMoney(order.total - order.wallet_amount_used)}
      taxAmount={order.tax_amount}
    />
  );
}
