import { isProductNegotiable } from '@baci/shared/lib';
import { Check, Minus, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { asRoute } from '@/lib/routes';
import { CartPageNegotiationIcon } from './cart-page-negotiation-icon';

interface CartPageLineItemProps {
  hasPriceNegotiation: boolean;
  item: CartItem;
  merchantSlug?: string;
  onOpenItemNegotiation: (item: CartItem) => void;
  onRemove: (cartItemId: string) => void;
  onToggleAssurance?: (cartItemId: string) => void;
  onUpdateQuantity: (cartItemId: string, quantity: number) => void;
  productHref: string;
  shippingInsuranceEnabled?: boolean;
}

export function CartPageLineItem({
  hasPriceNegotiation,
  item,
  merchantSlug,
  onOpenItemNegotiation,
  onRemove,
  onToggleAssurance,
  onUpdateQuantity,
  productHref,
  shippingInsuranceEnabled = false,
}: CartPageLineItemProps) {
  const isQuizGift = isQuizVoucherCartItem(item);
  const priceToUse = getCartItemCheckoutUnitPrice(item);
  const itemQuantity =
    typeof item.quantity === 'number' && !Number.isNaN(item.quantity)
      ? item.quantity
      : 0;
  const itemTotal = priceToUse * itemQuantity;
  const assuranceRate = item.assuranceRate ?? DEFAULT_ASSURANCE_RATE;
  const assuranceRateLabel = `${Number((assuranceRate * 100).toFixed(2))}%`;
  const assuranceCost = item.hasAssurance ? itemTotal * assuranceRate : 0;
  const itemIsNegotiable = isProductNegotiable({
    brand: item.brand,
    name: item.name,
  });

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden transition-all md:hover:shadow-md active:scale-[0.99] md:active:scale-100 touch-manipulation">
      <div className="flex gap-4">
        <Link
          href={asRoute(productHref)}
          className="ogabassey-product-card-image-surface w-20 h-20 md:w-28 md:h-28 bg-gray-50 rounded-xl border border-gray-100 p-2 shrink-0 flex items-center justify-center relative overflow-hidden"
        >
          <CdnFormatImage
            src={item.image || '/placeholder.png'}
            alt={item.name}
            fill
            sizes="(max-width: 768px) 80px, 112px"
            className="object-contain mix-blend-multiply p-2"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = '/placeholder.png';
            }}
          />
        </Link>

        <div className="flex-1 min-w-0 pr-8">
          <Link href={asRoute(productHref)}>
            <h3 className="font-bold text-gray-900 text-sm md:text-base line-clamp-2 leading-tight mb-2 hover:text-store-primary transition-colors">
              {item.name}
            </h3>
          </Link>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                item.condition?.toLowerCase() === 'new'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : 'bg-amber-50 text-amber-700 border-amber-100'
              }`}
            >
              {item.condition}
            </span>
            {item.selectedColor && (
              <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                <span
                  className="size-2 rounded-full border border-gray-300"
                  style={{
                    backgroundColor:
                      item.selectedColorValue || item.selectedColor,
                  }}
                />
                <span className="text-[10px] text-gray-600">
                  {item.selectedColor}
                </span>
              </div>
            )}
            {item.secondaryColor && (
              <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                <span className="text-[9px] text-blue-600 font-bold">
                  Pref 2:
                </span>
                <span className="text-[10px] text-gray-600">
                  {item.secondaryColor}
                </span>
              </div>
            )}
            {item.selectedStorage && (
              <div className="bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-[10px] text-gray-600">
                {item.selectedStorage}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(item.cartItemId)}
          className="absolute top-4 right-4 text-store-primary md:hover:text-store-primary p-1.5 md:hover:bg-store-primary/5 rounded-full transition-colors active:bg-store-primary/5"
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="my-3 border-t border-dashed border-gray-100" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center border border-gray-200 rounded-lg h-9 md:h-10 bg-gray-50">
          <button
            type="button"
            onClick={() => onUpdateQuantity(item.cartItemId, itemQuantity - 1)}
            className="px-3 h-full hover:bg-white text-gray-500 rounded-l-lg transition-colors border-r border-gray-200 active:bg-gray-200"
            disabled={itemQuantity <= 1}
            aria-label={`Decrease quantity for ${item.name}`}
          >
            <Minus size={14} />
          </button>
          <span className="w-8 text-center text-xs md:text-sm font-bold text-gray-900">
            {itemQuantity}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQuantity(item.cartItemId, itemQuantity + 1)}
            className="px-3 h-full hover:bg-white text-gray-500 rounded-r-lg transition-colors border-l border-gray-200 active:bg-gray-200"
            aria-label={`Increase quantity for ${item.name}`}
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="text-right">
          {isQuizGift ? (
            <div className="font-bold text-store-primary text-base md:text-xl">
              Free gift
            </div>
          ) : item.negotiatedPrice ? (
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40">
                ₦{((item.price || 0) * item.quantity).toLocaleString()}
              </span>
              <span className="font-bold text-store-primary text-base md:text-xl">
                ₦{(itemTotal || 0).toLocaleString()}
              </span>
            </div>
          ) : (
            <div className="font-bold text-gray-900 text-base md:text-xl">
              ₦{(itemTotal || 0).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-3 justify-between items-center">
        {/* An assured line keeps its removal control even when the
            setting is off, so the fee stays removable pre-checkout. */}
        {(shippingInsuranceEnabled || item.hasAssurance) && (
          <label className="flex items-start gap-2 cursor-pointer select-none group active:opacity-70 max-w-[70%]">
            <div className="relative flex items-center mt-0.5">
              <input
                type="checkbox"
                checked={item.hasAssurance || false}
                onChange={() => onToggleAssurance?.(item.cartItemId)}
                className="peer sr-only"
              />
              <div className="w-9 h-5 bg-store-background-text/20 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-store-primary-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-store-background after:border-store-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-store-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <ShieldCheck size={12} className="text-store-primary" />
                {merchantSlug === 'ogabassey'
                  ? 'Ogabassey Assurance'
                  : 'Order Protection'}
              </span>
              <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                {item.hasAssurance ? (
                  <>
                    {merchantSlug === 'ogabassey' ? (
                      <>
                        Covers{' '}
                        <span className="font-bold text-gray-700">
                          Screen & Liquid Damage
                        </span>
                      </>
                    ) : (
                      'Standard Shipping Protection'
                    )}
                    <span className="ml-1 text-store-primary font-bold">
                      +₦{(assuranceCost || 0).toLocaleString()}
                    </span>
                  </>
                ) : (
                  `${merchantSlug === 'ogabassey' ? 'Device Protection' : 'Safety & Shipping Coverage'} (+${assuranceRateLabel})`
                )}
              </p>
            </div>
          </label>
        )}

        {hasPriceNegotiation && !isQuizGift && (
          <div className="flex items-center gap-2">
            {item.negotiationStatus === 'accepted' ? (
              <div className="flex items-center gap-1.5 text-xs font-bold text-store-primary bg-store-primary/5 px-3 py-1.5 rounded-lg border border-store-primary/15">
                <Check size={12} strokeWidth={3} />
                <span>
                  Matched @ ₦{(item.negotiatedPrice || 0).toLocaleString()}
                </span>
              </div>
            ) : itemIsNegotiable ? (
              <button
                type="button"
                onClick={() => onOpenItemNegotiation(item)}
                className="flex items-center gap-1.5 text-xs font-bold text-store-primary md:hover:bg-store-primary/5 px-2 py-1.5 rounded-lg transition-colors border border-store-primary/15 md:hover:border-store-primary/40 active:bg-store-primary/5 active:scale-95"
              >
                <CartPageNegotiationIcon size={14} />
                <span>Negotiate</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
                <Check size={12} strokeWidth={3} />
                <span>Best price</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
