'use client';

import { ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react';
import type React from 'react';
import { useId, useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import type { DeliveryMethod } from '../pages/checkout/types';

interface MobileOrderSummaryProps {
    cart: CartItem[];
    cartTotal: number;
    deliveryCost: number;
    deliveryMethod: DeliveryMethod | null;
    giftWrappingCost: number;
    walletBalance: number;
    payWithWallet: boolean;
    walletAmountUsed: number;
    remainingAmount: number;
    taxAmount?: number;
    discountAmount?: number;
}

export const MobileOrderSummary: React.FC<MobileOrderSummaryProps> = ({
    cart,
    cartTotal,
    deliveryCost,
    deliveryMethod,
    giftWrappingCost,
    walletBalance: _walletBalance,
    payWithWallet,
    walletAmountUsed,
    remainingAmount,
    taxAmount = 0,
    discountAmount = 0,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const orderSummaryId = useId();
    const { formatCurrencyAuto, currencyCode } = useCurrency();

    return (
        <div className="lg:hidden bg-store-background border-b border-store-background-text/15">
            <div className="max-w-[1400px] mx-auto px-4">
                {/* Toggle Header */}
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={orderSummaryId}
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full py-4 flex items-center justify-between text-sm"
                >
                    <div className="flex items-center gap-2 text-store-primary font-medium">
                        <ShoppingBag size={18} />
                        <span>{isExpanded ? 'Hide' : 'Show'} order summary</span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    <span className="font-bold text-store-background-text text-lg">
                        {formatCurrencyAuto(remainingAmount)}
                    </span>
                </button>

                {/* Collapsible Content */}
                <div
                    id={orderSummaryId}
                    aria-hidden={!isExpanded}
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'visible max-h-[80vh] opacity-100 pb-6' : 'invisible max-h-0 opacity-0'
                        }`}
                >
                    {/* Items List */}
                    <div className="space-y-4 mb-6 pt-2">
                        {cart.map((item) => (
                            <div key={item.cartItemId} className="flex gap-3">
                                <div className="ogabassey-product-card-image-surface relative size-16 bg-store-background rounded-lg border border-store-background-text/10 p-1 shrink-0">
                                    <CdnFormatImage
                                        src={item.image || '/placeholder.png'}
                                        alt={item.name}
                                        fill
                                        sizes="64px"
                                        className="object-contain mix-blend-multiply"
                                    />
                                    <span className="absolute -top-2 -right-2 size-5 bg-store-background text-store-primary-text text-[10px] font-bold rounded-full flex items-center justify-center">
                                        {item.quantity}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0 py-1">
                                    <p className="text-sm font-bold text-store-background-text line-clamp-2 leading-snug">
                                        {item.name}
                                    </p>
                                    <p className="text-sm text-store-background-text/60 mt-1">
                                        {formatCurrencyAuto(item.negotiatedPrice ?? item.price)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-store-background-text/15 my-4" />

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
        </div>
    );
};
