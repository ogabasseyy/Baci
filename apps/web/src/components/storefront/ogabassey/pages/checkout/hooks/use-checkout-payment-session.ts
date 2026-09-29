'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import type { DiscountResult } from '@/components/storefront/checkout/discount-code-input';
import { loadWalletBalance } from '../checkout-page-data-loaders';
import type { RedvaultQuoteSummary } from '../components/redvault/RedvaultPaymentOption';
import type {
  RedvaultPreparedOrder,
  RedvaultStatus,
} from '../handlers/redvault-prepared-order-submit';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import { getRedvaultCompatibleCheckoutValues } from '../redvault-compatible-checkout-values';
import type { PaymentMethod, PaymentTab } from '../types';

interface UseCheckoutPaymentSessionOptions {
  baseTotal: number;
  clearPendingCheckoutOrder: () => void;
  currencyCode: string;
  discountSubtotal: number;
  hasAuthenticatedUser: boolean;
  hasCheckoutCartItems: boolean;
  isOrderInFlightRef: { current: boolean };
  merchantSlug?: string;
  pendingCheckoutOrder: PendingCheckoutOrderSnapshot | null;
  walletSessionUserId?: string;
  resumeOrderId: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  resumedOrder: { id: string } | null;
}

/** Own payment selection/fencing, customer wallet state, and payable totals. */
export function useCheckoutPaymentSession({
  baseTotal,
  clearPendingCheckoutOrder,
  currencyCode,
  discountSubtotal,
  hasAuthenticatedUser,
  hasCheckoutCartItems,
  isOrderInFlightRef,
  merchantSlug,
  pendingCheckoutOrder,
  preferredGateway,
  resumeOrderId,
  resumedOrder,
  walletSessionUserId,
}: UseCheckoutPaymentSessionOptions) {
  const [tab, setTab] = useState<PaymentTab>('full');
  const [method, setMethod] = useState<PaymentMethod>('');
  const [redvaultSummary, setRedvaultSummary] =
    useState<RedvaultQuoteSummary | null>(null);
  const [redvaultStatus, setRedvaultStatus] = useState<RedvaultStatus>('idle');
  const [redvaultOrderReady, setRedvaultOrderReady] =
    useState<RedvaultPreparedOrder | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<DiscountResult | null>(
    null
  );
  const [payForMeDetails, setPayForMeDetails] = useState({
    name: '',
    contact: '',
    note: '',
  });
  const walletRedemptionAllowed = hasCheckoutCartItems || !resumeOrderId;
  const updatePayWithWallet = (nextValue: boolean) => {
    if (walletRedemptionAllowed || !nextValue) {
      setPayWithWallet(nextValue);
    }
  };

  const selectMethod = (nextMethod: PaymentMethod) => {
    if (
      isOrderInFlightRef.current ||
      redvaultStatus === 'pending' ||
      redvaultStatus === 'held'
    ) {
      return;
    }
    if (
      nextMethod !== method &&
      (nextMethod === 'uba_redvault' || method === 'uba_redvault')
    ) {
      // A persisted Redvault fence remains authoritative during method
      // changes; the submit-time recovery resolver alone can clear it.
      if (pendingCheckoutOrder?.paymentMethod !== 'uba_redvault') {
        clearPendingCheckoutOrder();
      }
      setRedvaultSummary(null);
      setRedvaultStatus('idle');
      setRedvaultOrderReady(null);
    }
    setMethod(nextMethod);
  };

  const selectResumedPaymentMethod = useEffectEvent(() => {
    if (!preferredGateway) return;
    setTab('installments');
    selectMethod(preferredGateway);
  });
  useEffect(() => {
    if (resumedOrder && preferredGateway) {
      selectResumedPaymentMethod();
    }
  }, [preferredGateway, resumedOrder]);

  useEffect(() => {
    if (!hasAuthenticatedUser || !merchantSlug || !walletSessionUserId) {
      setWalletLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadWalletBalance({
      merchantSlug,
      signal: controller.signal,
      setWalletLoading,
      setWalletBalance,
      setPayWithWallet: (nextValue) => {
        if (walletRedemptionAllowed || !nextValue) {
          setPayWithWallet(nextValue);
        }
      },
    });
    return () => controller.abort();
  }, [
    hasAuthenticatedUser,
    merchantSlug,
    walletRedemptionAllowed,
    walletSessionUserId,
  ]);

  useEffect(() => {
    if (!walletRedemptionAllowed) {
      setPayWithWallet(false);
    }
  }, [walletRedemptionAllowed]);

  // A resumed order's persisted total already includes its discount. The
  // checkout can render while the resume request is pending, so ignore any
  // discount entered during that brief loading window once resume is known.
  const resumedOrderSuppliesPaymentBase =
    Boolean(resumeOrderId) && !hasCheckoutCartItems;
  const discountAmount =
    appliedDiscount && !resumedOrderSuppliesPaymentBase
      ? (appliedDiscount.discount_amount ??
        (appliedDiscount.discount_type === 'percentage'
          ? Math.round(
              discountSubtotal * (appliedDiscount.discount_value / 100)
            )
          : Math.min(appliedDiscount.discount_value, discountSubtotal)))
      : 0;
  const checkoutValues = getRedvaultCompatibleCheckoutValues({
    baseTotal,
    discountAmount,
    discountCode: appliedDiscount?.code,
    paymentMethod: method,
    payWithWallet: walletRedemptionAllowed && payWithWallet,
    walletBalance,
    walletCurrencySupported: currencyCode === 'NGN',
  });

  return {
    tab,
    setTab,
    method,
    selectMethod,
    redvault: {
      summary: redvaultSummary,
      setSummary: setRedvaultSummary,
      status: redvaultStatus,
      setStatus: setRedvaultStatus,
      orderReady: redvaultOrderReady,
      setOrderReady: setRedvaultOrderReady,
    },
    wallet: {
      balance: walletBalance,
      setBalance: setWalletBalance,
      loading: walletLoading,
      currencySupported: currencyCode === 'NGN',
      redemptionAllowed: walletRedemptionAllowed,
      payWithWallet: walletRedemptionAllowed && payWithWallet,
      setPayWithWallet: updatePayWithWallet,
      amountUsed: checkoutValues.walletAmountUsed,
      remainingAmount: checkoutValues.total - checkoutValues.walletAmountUsed,
    },
    discount: {
      applied: appliedDiscount,
      setApplied: setAppliedDiscount,
      amount: checkoutValues.discountAmount,
      code: checkoutValues.discountCode,
    },
    payForMe: {
      details: payForMeDetails,
      setDetails: setPayForMeDetails,
      isValid:
        method === 'payforme'
          ? Boolean(payForMeDetails.name && payForMeDetails.contact)
          : true,
    },
    checkoutValues,
    total: checkoutValues.total,
  };
}
