'use client';

import { toast } from '@/hooks/use-toast';
import type { useCheckoutFinancialSession } from './use-checkout-financial-session';
import { useEffect, useState } from 'react';
import {
  buildCheckoutOrderItems,
  type CheckoutOrderItemInput,
} from '@/lib/checkout/build-order-items';
import type { BrowserBankCardOffer } from '@/lib/checkout/get-browser-bank-card-offers';
import { findBrowserBankOfferRecovery } from '../find-browser-bank-offer-recovery';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import { previewBankCardOffer } from '../preview-bank-card-offer';

export function useBrowserBankCardOffer({
  offers,
  cart,
  fees,
  available,
  financial,
  formatCurrency,
  isOrderInFlightRef,
  buyer,
}: {
  offers: readonly BrowserBankCardOffer[];
  cart: CheckoutOrderItemInput[];
  fees: readonly number[];
  available: boolean;
  buyer?: {
    pendingOrder: PendingCheckoutOrderSnapshot | null;
    merchantId: string | undefined;
    checkoutEmail: string;
    accountEmail: string | undefined;
    paystackAvailable: boolean;
    currency: string;
  };
  isOrderInFlightRef: { current: boolean };
  financial: Pick<
    ReturnType<typeof useCheckoutFinancialSession>,
    'paymentSession' | 'summaryAmounts'
  >;
  formatCurrency: (amount: number) => string;
}) {
  const hasEligibleBuyer =
    !buyer ||
    Boolean(
      buyer.paystackAvailable &&
        buyer.currency === 'NGN' &&
        buyer.accountEmail?.trim().toLowerCase() ===
          buyer.checkoutEmail.trim().toLowerCase()
    );
  const savedAttempt =
    buyer &&
    findBrowserBankOfferRecovery(
      buyer.pendingOrder,
      buyer.merchantId,
      buyer.checkoutEmail,
      hasEligibleBuyer
    );
  const [recoverSaved, setRecoverSaved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const now = Date.now();
    const boundaries = offers.flatMap(({ startsAt, endsAt }) => [
      Date.parse(startsAt),
      Date.parse(endsAt),
    ]);
    const next = Math.min(...boundaries.filter((boundary) => boundary > now));
    if (!Number.isFinite(next)) return;

    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(next - now, 2_147_483_647)
    );
    return () => clearTimeout(timer);
  }, [offers, clock]);

  const items =
    hasEligibleBuyer && available && offers.length
      ? buildCheckoutOrderItems(cart)
      : [];
  const now = Date.now();
  const options = items.length
    ? offers.flatMap((offer) => {
        const price = previewBankCardOffer(offer, items, fees, now);
        return price ? [{ offer, price }] : [];
      })
    : [];
  const choice = options.find(({ offer }) => offer.id === selectedId);
  const { paymentSession, summaryAmounts } = financial;
  const selected = paymentSession.method === 'paystack' ? selectedId : null;
  const storedOfferId = savedAttempt?.checkoutFingerprint.split(':')[1];
  const recoveryActive =
    paymentSession.method === 'paystack' &&
    Boolean(
      savedAttempt &&
        (recoverSaved || (selected && selected === storedOfferId && !choice))
    );
  const offer = selected && !recoveryActive ? (choice?.price ?? null) : null;
  const selectMethod: typeof paymentSession.selectMethod = (method) => {
    if (isOrderInFlightRef.current) return;
    setSelectedId(null);
    setRecoverSaved(false);
    paymentSession.selectMethod(method);
  };
  const total =
    recoveryActive && savedAttempt
      ? savedAttempt.amountDueToGateway
      : offer
        ? offer.payableKobo / 100
        : paymentSession.total;
  return {
    offer,
    recoverSavedOffer: recoveryActive,
    model: {
      options,
      selectedId: selected,
      recovery: savedAttempt
        ? {
            active: recoveryActive,
            total: formatCurrency(savedAttempt.amountDueToGateway),
            select() {
              if (isOrderInFlightRef.current) return;
              setSelectedId(null);
              setRecoverSaved(true);
              paymentSession.selectMethod('paystack');
            },
          }
        : undefined,
      select(offerId: string | null) {
        if (isOrderInFlightRef.current) return;
        setRecoverSaved(false);
        setSelectedId(offerId);
        paymentSession.selectMethod(offerId ? 'paystack' : '');
      },
      format: (kobo: number) => formatCurrency(kobo / 100),
    },
    presentation: {
      paymentSession:
        offers.length === 0 && !savedAttempt
          ? paymentSession
          : {
              ...paymentSession,
              selectMethod,
              total,
              wallet:
                offer || recoveryActive
                  ? { ...paymentSession.wallet, remainingAmount: total }
                  : paymentSession.wallet,
            },
      summaryAmounts: offer
        ? { ...summaryAmounts, summaryDiscountAmount: offer.discountKobo / 100 }
        : summaryAmounts,
    },
    submit(placeOrder: () => void | Promise<void>) {
      if (recoveryActive) return placeOrder();
      // Recheck even if a background tab has delayed the boundary timer.
      if (
        selected &&
        (!choice || Date.now() >= Date.parse(choice.offer.endsAt))
      ) {
        setClock(Date.now());
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
