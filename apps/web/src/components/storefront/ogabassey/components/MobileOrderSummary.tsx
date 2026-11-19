'use client';

import { CartVariantDetails } from './cart-variant-details';

import { ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import { isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import { useCurrency } from '@/hooks/use-currency';
import type { DeliveryMethod } from '../pages/checkout/types';
import { useMobileKeyboardOpen } from './use-mobile-keyboard-open';

export interface MobileOrderSummaryProps {
    cart: CartItem[];
    cartTotal: number;
    deliveryCost: number;
    deliveryMethod: DeliveryMethod | null;
    giftWrappingCost: number;
    walletBalance: number;
    showWalletControl?: boolean;
    walletSelected?: boolean;
    setPayWithWallet?: (value: boolean) => void;
    payWithWallet: boolean;
    walletAmountUsed: number;
    remainingAmount: number;
    currency?: string;
    taxAmount?: number;
    discountAmount?: number;
}

export const MobileOrderSummary: React.FC<MobileOrderSummaryProps> = ({
    cart,
    cartTotal,
    deliveryCost,
    deliveryMethod,
    giftWrappingCost,
    walletBalance,
    showWalletControl = false,
    walletSelected,
    setPayWithWallet,
    payWithWallet,
    walletAmountUsed,
    remainingAmount,
    currency,
    taxAmount = 0,
    discountAmount = 0,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const summaryRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!isExpanded) return;
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !summaryRef.current?.contains(event.target)) setIsExpanded(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [isExpanded]);
    const keyboardOpen = useMobileKeyboardOpen();
    const orderSummaryId = useId();
    const merchantCurrency = useCurrency();
    const currencyCode = currency ?? merchantCurrency.currencyCode;
    const formatCurrencyAuto = currency ? (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount) : merchantCurrency.formatCurrencyAuto;

    return (
        <aside ref={summaryRef} aria-label="Order summary" hidden={keyboardOpen} className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-store-background border-t border-store-background-text/15 shadow-[0_-6px_24px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
            <div className="max-w-[1400px] mx-auto px-4 flex flex-col-reverse">
                {/* Toggle Header */}
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} order summary ${formatCurrencyAuto(remainingAmount)}`}
                    aria-controls={orderSummaryId}
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full py-3 flex items-center justify-between text-sm"
                >
                    <div className="flex items-center gap-2 text-store-primary font-medium">
                        <ShoppingBag size={18} />
                        <span>{isExpanded ? 'Hide' : 'View'} summary</span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    <span className="text-right text-store-background-text">
                        <span className="block font-bold text-lg">{formatCurrencyAuto(remainingAmount)}</span>
                        {payWithWallet && walletAmountUsed > 0 && <span className="block text-xs text-store-background-text/60">Wallet credit applied</span>}
                    </span>
                </button>

                {/* Collapsible Content */}
                <div
                    id={orderSummaryId}
                    aria-hidden={!isExpanded}
                    className={`overflow-x-hidden overflow-y-auto transition-all duration-300 ease-in-out ${isExpanded ? 'visible max-h-[80vh] opacity-100 pb-6' : 'invisible max-h-0 opacity-0'
                        }`}
                >
                    {/* Items List */}
                    <div className="space-y-4 mb-6 pt-2">
                        {cart.map((item, index) => (
                            <div key={item.cartItemId || (item.variantId ? `${item.id}:${item.variantId}` : `legacy-${index}:${item.id}`)} className="flex gap-3">
                                <div className="ogabassey-product-card-image-surface relative size-16 bg-store-background rounded-lg border border-store-background-text/10 p-1 shrink-0">
                                    <CdnFormatImage
                                        src={item.image || '/placeholder.png'}
                                        alt={item.name}
                                        fill
                                        sizes="64px"
                                        className="object-contain mix-blend-multiply"
                                    />
                                    <span className="absolute -top-2 -right-2 size-5 bg-store-primary text-store-primary-text text-[10px] font-bold rounded-full flex items-center justify-center">
                                        {item.quantity}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0 py-1">
                                    <p className="text-sm font-bold text-store-background-text line-clamp-2 leading-snug">
                                        {item.name}
                                    </p>
                                    <CartVariantDetails item={item} className="text-store-background-text/70" />
                                    <p className="text-sm text-store-background-text/60 mt-1">
                                        {isQuizVoucherCartItem(item) ? 'Free gift' : formatCurrencyAuto(item.negotiatedPrice ?? item.price)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-store-background-text/15 my-4" />

                    {showWalletControl && setPayWithWallet && (
                        <div className="flex items-center justify-between gap-4 pb-4 text-store-background-text">
                            <div><p className="text-sm font-semibold">Use wallet credit</p><p className="text-xs text-store-background-text/70">{formatCurrencyAuto(walletBalance)} available</p></div>
                            <button type="button" role="switch" aria-label="Use wallet credit" aria-checked={walletSelected ?? payWithWallet} onClick={() => setPayWithWallet(!(walletSelected ?? payWithWallet))} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${(walletSelected ?? payWithWallet) ? 'bg-store-primary' : 'bg-store-background-text/30'}`}><span className={`absolute left-1 top-1 size-5 rounded-full transition-transform ${(walletSelected ?? payWithWallet) ? 'bg-store-primary-text translate-x-5' : 'bg-store-background-text'}`} /></button>
                        </div>
                    )}

                    {/* Cost Breakdown */}
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-store-background-text/70">
                            <span>Subtotal</span>
                            <span>{formatCurrencyAuto(cartTotal)}</span>
                        </div>
                        <div className="flex justify-between text-store-background-text/70">
                            <span>Delivery</span>
                            <span className={deliveryCost === 0 ? 'text-store-primary font-medium' : 'text-store-background-text'}>
                                {deliveryMethod === 'door' && deliveryCost === 0
                                    ? 'Calculated at next step'
                                    : deliveryCost === 0 ? 'Free' : formatCurrencyAuto(deliveryCost)}
                            </span>
                        </div>
                        {taxAmount > 0 && (
                            <div className="flex justify-between text-store-background-text/70">
                                <span>Tax</span>
                                <span>{formatCurrencyAuto(taxAmount)}</span>
                            </div>
                        )}
                        {discountAmount > 0 && (
                            <div className="flex justify-between text-store-primary font-medium">
                                <span>Discount</span>
                                <span>-{formatCurrencyAuto(discountAmount)}</span>
                            </div>
                        )}
                        {giftWrappingCost > 0 && (
                            <div className="flex justify-between text-store-background-text/70">
                                <span>Gift Wrapping</span>
                                <span>{formatCurrencyAuto(giftWrappingCost)}</span>
                            </div>
                        )}
                        {payWithWallet && walletAmountUsed > 0 && (
                            <div className="flex justify-between text-store-primary font-medium">
                                <span>Wallet Credit</span>
                                <span>-{formatCurrencyAuto(walletAmountUsed)}</span>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-store-background-text/15 my-4" />

                    <div className="flex justify-between text-base font-bold text-store-background-text items-baseline">
                        <span>Total</span>
                        <div className="text-right">
                            <span className="text-xs text-store-background-text/50 font-normal mr-2">{currencyCode}</span>
                            <span className="text-xl">{formatCurrencyAuto(remainingAmount)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
};
