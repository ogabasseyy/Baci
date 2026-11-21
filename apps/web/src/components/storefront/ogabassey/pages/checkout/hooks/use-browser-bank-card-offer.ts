'use client';

import { toast } from '@/hooks/use-toast';
import type { useCheckoutFinancialSession } from './use-checkout-financial-session';
import { useState } from 'react';
import {
  buildCheckoutOrderItems,
  type CheckoutOrderItemInput,
} from '@/lib/checkout/build-order-items';
import type { BrowserBankCardOffer } from '@/lib/checkout/get-browser-bank-card-offers';
import { previewBankCardOffer } from '../preview-bank-card-offer';

export function useBrowserBankCardOffer({
  offers,
  cart,
  fees,
  available,
  financial,
  formatCurrency,
  isOrderInFlightRef,
}: {
  offers: readonly BrowserBankCardOffer[];
  cart: CheckoutOrderItemInput[];
  fees: readonly number[];
  available: boolean;
  isOrderInFlightRef: { current: boolean };
  financial: Pick<
    ReturnType<typeof useCheckoutFinancialSession>,
    'paymentSession' | 'summaryAmounts'
  >;
  formatCurrency: (amount: number) => string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = available && offers.length ? buildCheckoutOrderItems(cart) : [];
  const now = Date.now();
  const options = items.length
    ? offers.flatMap((offer) => {
        const price = previewBankCardOffer(offer, items, fees, now);
        return price ? [{ offer, price }] : [];
      })
    : [];
  const choice =
    options.find(({ offer }) => offer.id === selectedId)?.price ?? null;
  const { paymentSession, summaryAmounts } = financial;
  const selected = paymentSession.method === 'paystack' ? selectedId : null;
  const offer = selected ? choice : null;
  const selectMethod: typeof paymentSession.selectMethod = (method) => {
    if (isOrderInFlightRef.current) return;
    setSelectedId(null);
    paymentSession.selectMethod(method);
  };
  const total = offer ? offer.payableKobo / 100 : paymentSession.total;
  return {
    offer,
    model: {
      options,
      selectedId: selected,
      select(offerId: string | null) {
        if (isOrderInFlightRef.current) return;
        setSelectedId(offerId);
        paymentSession.selectMethod(offerId ? 'paystack' : '');
      },
      format: (kobo: number) => formatCurrency(kobo / 100),
    },
    presentation: {
      paymentSession:
        offers.length === 0
          ? paymentSession
          : {
              ...paymentSession,
              selectMethod,
              total,
              wallet: offer
                ? { ...paymentSession.wallet, remainingAmount: total }
                : paymentSession.wallet,
            },
      summaryAmounts: offer
        ? { ...summaryAmounts, summaryDiscountAmount: offer.discountKobo / 100 }
        : summaryAmounts,
    },
    submit(placeOrder: () => void | Promise<void>) {
      if (selected && !offer) {
        toast({
          title: 'Bank offer unavailable',
          description: 'Choose an available payment option to continue.',
          variant: 'destructive',
        });
        return;
      }
      return placeOrder();
    },
  };
}
