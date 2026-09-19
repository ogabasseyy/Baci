import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import { createWalletFundedBankTransferIntent } from '@/lib/checkout/wallet-funded-bank-transfer';
import type { WalletOrderFundingIntentCreateResponse } from '@/lib/order-wallet-funding-intent';
import { trackError } from '@/services/analytics';
import type { CheckoutCompletionAttribution } from '@/services/track-checkout-payment-completed-once';
import {
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';

interface StartWalletFundedBankTransferCheckoutParams {
  attribution?: Pick<
    CheckoutCompletionAttribution,
    'customerEmail' | 'customerPhone' | 'subtotal' | 'shipping' | 'tax'
  >;
  isOrderInFlight: MutableRefObject<boolean>;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}

export function startWalletFundedBankTransferCheckout({
  attribution,
  isOrderInFlight,
  orderId,
  orderNumber,
  orderTotal,
  setIsProcessing,
  trackingToken,
}: StartWalletFundedBankTransferCheckoutParams) {
  return createWalletFundedBankTransferIntent({
    merchantId: CHECKOUT_MERCHANT_ID,
    merchantSlug: CHECKOUT_MERCHANT_SLUG,
    onFallback: ({ code, consent, message }) => {
      trackError('wallet_order_funding_intent_failed', message, {
        code,
        ...(consent ? { consent: true } : {}),
        orderId,
      });
      Alert.alert(
        'Bank transfer unavailable',
        'Bank transfer to wallet is temporarily unavailable. We will use the standard bank transfer option instead.',
        [{ text: 'OK' }]
      );
    },
    onSuccess: (response) =>
      routeToWalletFundedBankTransfer({
        attribution,
        isOrderInFlight,
        orderId,
        orderNumber,
        orderTotal,
        response,
        setIsProcessing,
        trackingToken,
      }),
    orderId,
    requestConsent: requestWalletFundingAccountConsent,
  });
}

function requestWalletFundingAccountConsent() {
  return Promise.resolve(true);
}

function routeToWalletFundedBankTransfer({
  attribution,
  isOrderInFlight,
  orderId,
  orderNumber,
  orderTotal,
  response,
  setIsProcessing,
  trackingToken,
}: StartWalletFundedBankTransferCheckoutParams & {
  response: WalletOrderFundingIntentCreateResponse;
}) {
  isOrderInFlight.current = false;
  setIsProcessing(false);
  router.push({
    pathname: '/bank-transfer',
    params: {
      accountName: response.account.accountName,
      accountNumber: response.account.accountNumber,
      amount: String(response.intent.expectedAmount),
      bankName: response.account.bankName,
      orderTotal: String(orderTotal),
      intentId: response.intent.id,
      merchantId: CHECKOUT_MERCHANT_ID,
      merchantSlug: CHECKOUT_MERCHANT_SLUG,
      orderId,
      orderNumber,
      reference: response.intent.id,
      walletFunded: 'true',
      ...(trackingToken && { trackingToken }),
      // Route params are strings: carry the checkout attribution snapshot
      // so the wallet-funded completion keeps identity and breakdown.
      ...(attribution?.customerEmail && {
        customerEmail: attribution.customerEmail,
      }),
      ...(attribution?.customerPhone && {
        customerPhone: attribution.customerPhone,
      }),
      ...(typeof attribution?.subtotal === 'number' && {
        subtotal: String(attribution.subtotal),
      }),
      ...(typeof attribution?.shipping === 'number' && {
        shipping: String(attribution.shipping),
      }),
      ...(typeof attribution?.tax === 'number' && {
        tax: String(attribution.tax),
      }),
    },
  });
}
