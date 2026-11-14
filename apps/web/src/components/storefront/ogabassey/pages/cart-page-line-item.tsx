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
import { getCartItemConditionBadge } from '../components/cart-item-badge-style';
import { CartVariantDetails } from '../components/cart-variant-details';
import { CartAssuranceRow } from './cart-assurance-row';
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
  const conditionBadge = getCartItemConditionBadge(item);

  return (
    <div className="bg-store-background p-4 rounded-2xl shadow-xs border border-store-border relative overflow-hidden transition-all md:hover:shadow-md active:scale-[0.99] md:active:scale-100 touch-manipulation">
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
            className="ogabassey-product-card-image-surface w-[72px] h-[72px] md:w-28 md:h-28 bg-store-background-text/5 rounded-xl border border-store-border p-1.5 shrink-0 flex items-center justify-center relative overflow-hidden"
          >
            <CdnFormatImage
              src={item.image || '/placeholder.png'}
              alt={item.name}
              fill
              sizes="(max-width: 768px) 72px, 112px"
              className="object-contain mix-blend-multiply p-1.5"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = '/placeholder.png';
              }}
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
                  onUpdateQuantity(item.cartItemId, itemQuantity - 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-l-md transition-colors border-r border-store-border active:bg-store-background-text/10 disabled:opacity-40"
                disabled={itemQuantity <= 1}
                aria-label={`Decrease quantity for ${item.name}`}
              >
                <Minus size={11} />
              </button>
              <span className="w-6 text-center text-[11px] font-semibold text-store-background-text">
                {itemQuantity}
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateQuantity(item.cartItemId, itemQuantity + 1)
                }
                className="px-2 h-full hover:bg-store-background text-store-background-text/60 rounded-r-md transition-colors border-l border-store-border active:bg-store-background-text/10 disabled:opacity-40"
                disabled={isQuizGift}
                aria-label={`Increase quantity for ${item.name}`}
              >
                <Plus size={11} />
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
            {hasPriceNegotiation && !isQuizGift ? (
              <div className="flex items-center min-w-0">
                {item.negotiationStatus === 'accepted' ? (
                  <div className="inline-flex items-center gap-1 text-[10px] md:text-[11px] font-semibold text-store-primary bg-store-primary/5 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                    <Check size={11} strokeWidth={3} />
                    <span>
                      Matched @ ₦{(item.negotiatedPrice || 0).toLocaleString()}
                    </span>
                  </div>
                ) : itemIsNegotiable ? (
                  <button
                    type="button"
                    onClick={() => onOpenItemNegotiation(item)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-store-primary hover:opacity-80 py-0.5 transition-opacity active:scale-95 whitespace-nowrap"
                  >
                    <CartPageNegotiationIcon size={12} />
                    <span>Negotiate</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1 text-[11px] font-medium text-store-background-text/40 whitespace-nowrap">
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
                <div className="font-bold text-store-primary text-sm md:text-lg whitespace-nowrap">
                  Free gift
                </div>
              ) : item.negotiatedPrice ? (
                <div className="flex flex-col items-end leading-tight">
                  <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40 whitespace-nowrap">
                    ₦{((item.price || 0) * itemQuantity).toLocaleString()}
                  </span>
                  <span className="font-bold text-store-primary text-sm md:text-lg whitespace-nowrap">
                    ₦{(itemTotal || 0).toLocaleString()}
                  </span>
                </div>
              ) : (
                <div className="font-bold text-store-background-text text-sm md:text-lg whitespace-nowrap">
                  ₦{(itemTotal || 0).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(item.cartItemId)}
          className="absolute top-3.5 right-3.5 text-store-background-text/40 hover:text-store-primary p-1 md:hover:bg-store-primary/5 rounded-full transition-colors active:bg-store-primary/5"
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {(shippingInsuranceEnabled || item.hasAssurance) && (
        <fieldset
          aria-label="Product extras"
          className="mt-3 pt-3 border-t border-store-border"
        >
          {/* An assured line keeps its removal control even when the
            setting is off, so the fee stays removable pre-checkout. */}
          {merchantSlug === 'ogabassey' ? (
            <CartAssuranceRow
              hasAssurance={item.hasAssurance}
              assuranceCost={assuranceCost}
              assuranceRateLabel={assuranceRateLabel}
              cartItemId={item.cartItemId}
              onToggle={onToggleAssurance}
            />
          ) : (
            <label className="flex w-full items-center gap-2.5 cursor-pointer select-none group active:opacity-70">
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
                        +₦{(assuranceCost || 0).toLocaleString('en-NG')}
                      </span>
                    </>
                  ) : (
                    `Safety & Shipping Coverage (+${assuranceRateLabel})`
                  )}
                </span>
              </span>
            </label>
          )}
        </fieldset>
      )}
    </div>
  );
}
