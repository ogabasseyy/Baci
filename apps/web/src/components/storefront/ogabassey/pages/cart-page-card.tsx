'use client';

import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { type CartItem, useCart } from '@/hooks/cart';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { isProductNegotiable } from '@baci/shared/lib';
import { Check, HandCoins, Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { CartAssuranceRow } from './cart-assurance-row';
import { getCartItemConditionBadge } from '../components/cart-item-badge-style';
import { CartVariantDetails } from '../components/cart-variant-details';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';

interface CartPageCardProps {
  basePath: string;
  hasPriceNegotiation?: boolean;
  item: CartItem;
  onOpenItemNegotiation: (item: CartItem) => void;
  shippingInsuranceEnabled?: boolean;
  cartMerchantContextMatches?: boolean;
}

export function CartPageCard({
  basePath,
  hasPriceNegotiation = false,
  item,
  onOpenItemNegotiation,
  shippingInsuranceEnabled = false,
  cartMerchantContextMatches = true,
}: CartPageCardProps) {
  const { removeFromCart, toggleAssurance, updateQuantity } = useCart();
  const productHref = getStorefrontProductHref(item, basePath);
  const isQuizGift = isQuizVoucherCartItem(item);
  const priceToUse = getCartItemCheckoutUnitPrice(item);
  const itemTotal = priceToUse * item.quantity;
  const assuranceRate = item.assuranceRate ?? DEFAULT_ASSURANCE_RATE;
  const assuranceRateLabel = `${Number((assuranceRate * 100).toFixed(2))}%`;
  const assuranceCost = item.hasAssurance
    ? itemTotal * assuranceRate
    : 0;
  const conditionBadge = getCartItemConditionBadge(item);
  const showAssuranceRow =
    cartMerchantContextMatches &&
    (shippingInsuranceEnabled || item.hasAssurance);

  return (
    <div
      key={item.cartItemId}
      className="bg-store-background p-4 rounded-2xl shadow-xs border border-store-border relative overflow-hidden transition-all md:hover:shadow-md active:scale-[0.99] md:active:scale-100 touch-manipulation"
    >
      <div className="flex gap-3.5 md:gap-4 items-start">
        <div className="relative shrink-0">
          {conditionBadge && (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded-full text-[10px] leading-none font-bold uppercase tracking-wider shadow-2xs ${conditionBadge.badgeClassName}`}
            >
              {conditionBadge.label}
            </span>
          )}
          <Link
            href={asRoute(productHref)}
            className="ogabassey-product-card-image-surface relative w-[72px] h-[72px] md:w-28 md:h-28 bg-store-background-text/5 rounded-xl border border-store-border p-1.5 shrink-0 flex items-center justify-center overflow-hidden"
          >
            <CdnFormatImage
              src={item.image || '/placeholder.png'}
              alt={item.name}
              width={112}
              height={112}
              sizes="(max-width: 768px) 72px, 112px"
              className="w-full h-full object-contain mix-blend-multiply"
            />
          </Link>
        </div>

        <div className="flex-1 min-w-0">
          <div className="pr-7">
            <Link href={asRoute(productHref)} className="group/title">
              <h3 className="font-bold text-store-background-text text-[13px] md:text-base line-clamp-1 leading-snug group-hover/title:text-store-primary transition-colors">
                {item.name}
              </h3>
            </Link>

            <CartVariantDetails item={item} presentation="chips" />
          </div>

          <div className="mt-2.5 flex items-center">
            <div className="inline-flex items-center border border-store-border rounded-md h-7 md:h-8 bg-store-background-text/5">
              <button
                type="button"
                onClick={() =>
                  updateQuantity(item.cartItemId, item.quantity - 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-l-md transition-colors border-r border-store-border active:bg-store-background-text/10 disabled:opacity-40"
                disabled={item.quantity <= 1}
                aria-label="Decrease quantity"
              >
                <Minus size={11} />
              </button>
              <span className="w-6 text-center text-[11px] font-semibold text-store-background-text">
                {item.quantity}
              </span>
              <button
                type="button"
                onClick={() =>
                  updateQuantity(item.cartItemId, item.quantity + 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-r-md transition-colors border-l border-store-border active:bg-store-background-text/10 disabled:opacity-40"
                disabled={isQuizGift}
                aria-label="Increase quantity"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
            <div className="flex items-center min-w-0">
              {hasPriceNegotiation && !isQuizGift ? (
                item.negotiationStatus === 'accepted' ? (
                  <div className="inline-flex items-center gap-1 text-[10px] md:text-[11px] font-semibold text-store-primary bg-store-primary/5 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                    <Check size={11} strokeWidth={3} />
                    <span>
                      Matched @ ₦
                      {item.negotiatedPrice?.toLocaleString()}
                    </span>
                  </div>
                ) : isProductNegotiable({
                    brand: item.brand,
                    name: item.name,
                  }) ? (
                  <button
                    type="button"
                    onClick={() => onOpenItemNegotiation(item)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-store-primary hover:opacity-80 py-0.5 transition-opacity active:scale-95 whitespace-nowrap"
                  >
                    <HandCoins size={12} />
                    <span>Negotiate</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1 text-[11px] font-medium text-store-background-text/40 whitespace-nowrap">
                    <Check size={11} strokeWidth={2.5} />
                    <span>Best price</span>
                  </div>
                )
              ) : (
                <span />
              )}
            </div>

            <div className="ml-auto text-right">
              {isQuizGift ? (
                <div className="font-bold text-store-primary text-sm md:text-lg whitespace-nowrap">
                  Free gift
                </div>
              ) : item.negotiatedPrice ? (
                <div className="flex flex-col items-end leading-tight">
                  <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40 whitespace-nowrap">
                    ₦{(item.price * item.quantity).toLocaleString()}
                  </span>
                  <span className="font-bold text-store-primary text-sm md:text-lg whitespace-nowrap">
                    ₦{itemTotal.toLocaleString()}
                  </span>
                </div>
              ) : (
                <div className="font-bold text-store-background-text text-sm md:text-lg whitespace-nowrap">
                  ₦{itemTotal.toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => removeFromCart(item.cartItemId)}
          className="absolute top-3.5 right-3.5 text-store-background-text/40 hover:text-store-primary p-1 md:hover:bg-store-primary/5 rounded-full transition-colors active:bg-store-primary/5"
          aria-label="Remove item"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {showAssuranceRow && (
        <div className="mt-3 pt-3 border-t border-store-border">
          <CartAssuranceRow
            hasAssurance={item.hasAssurance}
            assuranceCost={assuranceCost}
            assuranceRateLabel={assuranceRateLabel}
            cartItemId={item.cartItemId}
            onToggle={toggleAssurance}
          />
        </div>
      )}
    </div>
  );
}
