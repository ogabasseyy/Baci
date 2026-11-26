import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { CartVariantDetails } from '../../../components/cart-variant-details';
import type { ResumedOrder } from '../types';

export type CheckoutItem =
  | ({ kind: 'cart' } & CartItem)
  | ({ kind: 'resumed' } & ResumedOrder['items'][number]);

export function DesktopOrderSummaryLine({
  item,
  formatCurrencyAuto,
}: {
  item: CheckoutItem;
  formatCurrencyAuto: (amount: number) => string;
}) {
  const itemName =
    item.kind === 'cart' ? item.name : item.product_name;
  const itemImage =
    (item.kind === 'cart' ? item.image : item.image_url) ||
    '/placeholder.png';
  const isQuizGift =
    item.kind === 'cart' && isQuizVoucherCartItem(item);
  const itemPrice =
    item.kind === 'cart'
      ? getCartItemCheckoutUnitPrice(item)
      : item.price;
  return (
    <div
      className="flex gap-3"
      data-baci-checkout-product={item.kind === 'cart' ? item.id : undefined}
      data-baci-checkout-variant={item.kind === 'cart' ? item.variantId ?? '' : undefined}
      data-baci-checkout-quantity={item.kind === 'cart' ? item.quantity : undefined}
    >
      <div className="ogabassey-product-card-image-surface relative size-12 bg-gray-50 rounded-lg border border-gray-100 p-1 shrink-0">
        <CdnFormatImage
          src={itemImage}
          alt={itemName}
          fill
          sizes="48px"
          className="object-contain mix-blend-multiply"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 line-clamp-1">
          {itemName}
        </p>
        {/* Match this fixed white card; storefront text can be white in dark themes. */}
        <CartVariantDetails
          className="text-gray-500"
          item={
            item.kind === 'cart'
              ? item
              : {
                  variantAttributes: {
                    ...(typeof item.condition === 'string'
                      ? { condition: item.condition }
                      : {}),
                    ...(typeof item.variant_name === 'string'
                      ? { variant: item.variant_name }
                      : {}),
                  },
                }
          }
        />
        <div className="flex justify-between items-center text-xs text-gray-500 mt-0.5">
          <span>Qty: {item.quantity}</span>
          <span>
            {isQuizGift ? 'Free gift' : formatCurrencyAuto(itemPrice)}
          </span>
        </div>
      </div>
    </div>
  );
}
