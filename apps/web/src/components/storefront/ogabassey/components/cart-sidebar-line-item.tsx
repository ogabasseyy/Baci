'use client';

import { isProductNegotiable } from '@baci/shared/lib';
import {
  Check,
  HandCoins,
  Minus,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { CartAssuranceRow } from '../pages/cart-assurance-row';
import { getCartItemConditionBadge } from './cart-item-badge-style';
import { CartVariantDetails } from './cart-variant-details';

export function CartSidebarLineItem({
  item,
  basePath,
  hasPriceNegotiation,
  cartMerchantContextMatches,
  merchantSlug,
  shippingInsuranceEnabled,
  onRemove,
  onUpdateQuantity,
  onNegotiate,
  onToggleAssurance,
}: {
  item: CartItem;
  basePath: string | undefined;
  hasPriceNegotiation: boolean;
  cartMerchantContextMatches: boolean;
  merchantSlug?: string;
  shippingInsuranceEnabled?: boolean;
  onRemove: (cartItemId: string) => void;
  onUpdateQuantity: (cartItemId: string, quantity: number) => void;
  onNegotiate: (item: CartItem) => void;
  onToggleAssurance?: (cartItemId: string) => void;
}) {
  const productHref = asRoute(getStorefrontProductHref(item, basePath || ''));
  const isQuizGift = isQuizVoucherCartItem(item);
  const priceToUse = getCartItemCheckoutUnitPrice(item);
  const itemTotal = priceToUse * item.quantity;
  const assuranceRate = item.assuranceRate ?? DEFAULT_ASSURANCE_RATE;
  const assuranceRateLabel = `${Number((assuranceRate * 100).toFixed(2))}%`;
  const assuranceCost = itemTotal * assuranceRate;
  const conditionBadge = getCartItemConditionBadge(item);

  const showAssuranceRow =
    cartMerchantContextMatches &&
    (shippingInsuranceEnabled || item.hasAssurance);

  return (
    <div className="bg-store-background p-4 rounded-2xl shadow-xs border border-store-border relative overflow-hidden animate-in fade-in duration-300">
      <div className="flex gap-3.5 items-start">
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
            href={productHref}
            className="ogabassey-product-card-image-surface relative size-[72px] bg-store-background-text/5 rounded-xl border border-store-border p-1.5 shrink-0 flex items-center justify-center overflow-hidden group/image"
          >
            <CdnFormatImage
              src={item.image || '/placeholder.png'}
              alt={item.name}
              fill
              sizes="72px"
              className="object-contain mix-blend-multiply p-1.5"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/placeholder.png';
              }}
            />
          </Link>
        </div>

        <div className="flex-1 min-w-0">
          <div className="pr-7">
            <Link
              href={productHref}
              className="font-bold text-store-background-text line-clamp-1 text-[13px] leading-snug hover:text-store-primary transition-colors block"
            >
              {item.name}
            </Link>

            <CartVariantDetails item={item} presentation="chips" />
          </div>

          <div className="mt-2.5 flex items-center">
            <div className="inline-flex items-center border border-store-border rounded-md h-7 bg-store-background-text/5">
              <button
                type="button"
                onClick={() =>
                  onUpdateQuantity(item.cartItemId, item.quantity - 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-l-md transition-colors border-r border-store-border disabled:opacity-40"
                disabled={item.quantity <= 1 || isQuizGift}
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
                  onUpdateQuantity(item.cartItemId, item.quantity + 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-r-md transition-colors border-l border-store-border disabled:opacity-40"
                disabled={isQuizGift}
                aria-label="Increase quantity"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
            {hasPriceNegotiation && !isQuizGift ? (
              <div className="flex items-center min-w-0">
                {item.negotiationStatus === 'accepted' ? (
                  <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-store-primary bg-store-primary/5 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                    <Check size={11} strokeWidth={3} />
                    <span>
                      Matched @ ₦{item.negotiatedPrice?.toLocaleString()}
                    </span>
                  </div>
                ) : isProductNegotiable({
                    brand: item.brand,
                    name: item.name,
                  }) ? (
                  <button
                    type="button"
                    onClick={() => onNegotiate(item)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-store-primary hover:opacity-80 py-0.5 transition-opacity whitespace-nowrap"
                  >
                    <HandCoins size={12} />
                    <span>Negotiate</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1 text-[11px] font-medium text-store-background-text/45 whitespace-nowrap">
                    <Check size={11} strokeWidth={2.5} />
                    <span>Best price</span>
                  </div>
                )}
              </div>
            ) : (
              <span />
            )}

            <div className="ml-auto text-right">
              {isQuizGift ? (
                <div className="font-bold text-store-primary text-sm whitespace-nowrap">
                  Free gift
                </div>
              ) : item.negotiatedPrice ? (
                <div className="flex flex-col items-end leading-tight">
                  <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40 whitespace-nowrap">
                    ₦{(item.price * item.quantity).toLocaleString()}
                  </span>
                  <span className="font-bold text-store-primary text-sm whitespace-nowrap">
                    ₦{itemTotal.toLocaleString()}
                  </span>
                </div>
              ) : (
                <div className="font-bold text-store-background-text text-sm whitespace-nowrap">
                  ₦{itemTotal.toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(item.cartItemId)}
          className="absolute top-3.5 right-3.5 text-store-background-text/45 hover:text-store-primary p-1 rounded-full hover:bg-store-primary/5 transition-colors"
          aria-label="Remove item"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* BOTTOM SECTION: Full-width Assurance */}
      {showAssuranceRow && (
        <div className="mt-3 pt-3 border-t border-store-border">
          {merchantSlug === 'ogabassey' ? (
            <CartAssuranceRow
              hasAssurance={item.hasAssurance}
              assuranceCost={assuranceCost}
              assuranceRateLabel={assuranceRateLabel}
              cartItemId={item.cartItemId}
              onToggle={onToggleAssurance}
            />
          ) : (
            <label className="flex w-full items-center gap-2.5 cursor-pointer group">
              <span className="relative flex items-center shrink-0">
                <input
                  type="checkbox"
                  checked={item.hasAssurance || false}
                  onChange={() => onToggleAssurance?.(item.cartItemId)}
                  className="peer sr-only"
                />
                <span className="block w-7 h-4 bg-store-background-text/20 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-store-primary rounded-full peer peer-checked:after:translate-x-3 peer-checked:after:border-store-primary-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-store-background after:border-store-border after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-store-primary" />
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[11px] font-bold text-store-background-text flex items-center gap-1 whitespace-nowrap">
                  <ShieldCheck
                    size={12}
                    className="text-store-primary shrink-0"
                  />
                  Order Protection
                </span>
                <span className="block text-[10px] text-store-background-text/60 leading-tight mt-0.5 whitespace-nowrap">
                  {item.hasAssurance ? (
                    <>
                      Standard Shipping Protection
                      <span className="ml-1 text-store-primary font-semibold">
                        +₦{assuranceCost.toLocaleString('en-NG')}
                      </span>
                    </>
                  ) : (
                    `Safety & Shipping Coverage (+${assuranceRateLabel})`
                  )}
                </span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
