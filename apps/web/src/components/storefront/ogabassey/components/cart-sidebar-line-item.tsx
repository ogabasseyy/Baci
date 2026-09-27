'use client';

import Link from 'next/link';
import { isProductNegotiable } from '@baci/shared/lib';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  Check,
  HandCoins,
  Minus,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type CartItem } from '@/hooks/cart';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';

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

  return (
    <div className="flex gap-4 animate-in fade-in duration-300 border-b border-gray-50 pb-6 last:border-0 last:pb-0">
      <Link
        href={productHref}
        className="ogabassey-product-card-image-surface relative size-24 bg-gray-50 rounded-lg border border-gray-100 p-2 shrink-0 self-start mt-1 block group/image"
      >
        <CdnFormatImage
          src={item.image || '/placeholder.png'}
          alt={item.name}
          fill
          sizes="96px"
          className="object-contain mix-blend-multiply p-1"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/placeholder.png';
          }}
        />
        {/* Condition Badge - Bottom Center Overlay */}
        {item.condition && (
          <span
            className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-sm uppercase tracking-wider whitespace-nowrap z-10 ${item.condition?.toLowerCase() === 'new'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : 'bg-amber-100 text-amber-800 border-amber-200'
              }`}
          >
            {item.condition}
          </span>
        )}
      </Link>
      <div className="flex-1 flex flex-col justify-between min-h-[100px]">
        <div>
          <div className="flex justify-between items-start">
            <Link
              href={productHref}
              className="font-bold text-gray-900 line-clamp-1 text-sm hover:text-store-primary transition-colors"
            >
              {item.name}
            </Link>
            <button type="button"
              onClick={() => onRemove(item.cartItemId)}
              className="text-gray-400 hover:text-store-primary p-1 -mt-1 -mr-1"
              aria-label="Remove item"
            >
              <Trash2 size={16} />
            </button>
          </div>

          {/* Item Details: Color & Storage */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {/* Removed Condition from here, moved to image overlay */}

            {/* Color & Storage */}
            <div className="text-xs text-gray-500 flex items-center gap-1">
              {item.selectedColor && (
                <span className="flex items-center gap-1">
                  <span
                    className="size-2.5 rounded-full border border-gray-300 shadow-sm"
                    style={{
                      backgroundColor:
                        item.selectedColorValue || item.selectedColor,
                    }}
                  />
                  {item.selectedColor}
                </span>
              )}
              {item.secondaryColor && (
                <span className="text-[10px] text-blue-500">
                  (Pref 2: {item.secondaryColor})
                </span>
              )}
              {item.selectedStorage && (
                <>
                  <span>•</span>
                  <span>{item.selectedStorage}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: Quantity/Negotiate (Left) | Price (Right) */}
        <div className="flex items-end justify-between mt-3">
          <div className="flex flex-col gap-3">
            {/* Quantity */}
            <div className="flex items-center border border-gray-200 rounded-md w-fit">
              <button type="button"
                onClick={() =>
                  onUpdateQuantity(item.cartItemId, item.quantity - 1)
                }
                className="p-1 px-2 hover:bg-gray-50 text-gray-500"
                disabled={item.quantity <= 1}
                aria-label="Decrease quantity"
              >
                <Minus size={12} />
              </button>
              <span className="w-6 text-center text-xs font-medium">
                {item.quantity}
              </span>
              <button type="button"
                onClick={() =>
                  onUpdateQuantity(item.cartItemId, item.quantity + 1)
                }
                className="p-1 px-2 hover:bg-gray-50 text-gray-500"
                aria-label="Increase quantity"
              >
                <Plus size={12} />
              </button>
            </div>

            {/* Negotiation - Bottom Left */}
            {hasPriceNegotiation && !isQuizGift && (
              item.negotiationStatus === 'accepted' ? (
                <div className="flex items-center gap-1 text-[10px] font-bold text-store-primary bg-store-primary/5 px-1.5 py-0.5 rounded-md w-fit border border-store-primary/15">
                  <Check size={10} strokeWidth={3} />
                  <span>
                    Matched @ ₦{item.negotiatedPrice?.toLocaleString()}
                  </span>
                </div>
              ) : isProductNegotiable({
                  brand: item.brand,
                  name: item.name,
                }) ? (
                <button type="button"
                  onClick={() => onNegotiate(item)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-store-primary hover:text-store-primary transition-colors"
                >
                  <HandCoins size={14} />
                  <span>Negotiate</span>
                </button>
              ) : (
                <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-md w-fit border border-gray-200">
                  <Check size={10} strokeWidth={3} />
                  <span>Best price</span>
                </div>
              )
            )}
          </div>

          <div className="text-right pb-0.5">
            {isQuizGift ? (
              <div className="font-bold text-store-primary text-sm">
                Free gift
              </div>
            ) : item.negotiatedPrice ? (
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40">
                  ₦{(item.price * item.quantity).toLocaleString()}
                </span>
                <span className="font-bold text-store-primary text-sm">
                  ₦{itemTotal.toLocaleString()}
                </span>
              </div>
            ) : (
              <div className="font-bold text-gray-900 text-sm">
                ₦{itemTotal.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Assurance/Insurance Toggle */}
        {cartMerchantContextMatches && shippingInsuranceEnabled && (
          <div className="mt-4 pt-3 border-t border-gray-50">
            <label className="flex items-start gap-2 cursor-pointer group">
              <div className="relative flex items-center mt-0.5">
                <input
                  type="checkbox"
                  checked={item.hasAssurance || false}
                  onChange={() => onToggleAssurance?.(item.cartItemId)}
                  className="peer sr-only"
                />
                <div className="w-9 h-5 bg-store-background-text/20 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-store-primary-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-store-background after:border-store-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-store-primary" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <ShieldCheck
                      size={12}
                      className="text-store-primary"
                    />
                    {merchantSlug === 'ogabassey' ? 'Ogabassey Assurance' : 'Order Protection'}
                  </span>
                  {item.hasAssurance && (
                    <span className="text-xs font-bold text-gray-900">
                      +₦{assuranceCost.toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                  {item.hasAssurance ? (
                    <>
                      {merchantSlug === 'ogabassey' ? (
                        <>
                          Covers <span className="font-bold text-gray-700">Screen & Liquid Damage</span>
                        </>
                      ) : (
                        'Standard Shipping Protection'
                      )}
                    </>
                  ) : (
                    `${merchantSlug === 'ogabassey' ? 'Device Protection' : 'Safety & Shipping Coverage'} (+${assuranceRateLabel})`
                  )}
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
