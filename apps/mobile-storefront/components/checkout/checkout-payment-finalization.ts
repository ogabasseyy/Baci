import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { getFullyPaidStoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import { OrderError, type OrderResponse } from '@/services/orders';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';
import {
  routeFullyPaidPrizeSuccess,
  routeStoreCreditSuccess,
} from './checkout-fully-paid-routing';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
  type PendingCryptoOrder,
} from './checkout-screen.constants';
import { startWalletFundedBankTransferCheckout } from './checkout-wallet-funded-bank-transfer';
import {
  type PaymentInitializeData,
  toPaymentInitializeData,
} from './payment-initialize-data';

const PAYMENT_INIT_TIMEOUT_MS = 10_000;

interface FinalizeCheckoutPaymentParams {
  clearCart: () => void | Promise<void>;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  isOrderInFlight: MutableRefObject<boolean>;
  orderNumber: string;
  orderResponse: OrderResponse;
  runPostOrderSideEffects: () => void;
  selectedPayment: PaymentMethodType;
  setIsProcessing: (value: boolean) => void;
  setPendingOrder: (value: PendingCryptoOrder | null) => void;
  setShowCryptoSelection: (value: boolean) => void;
  shouldCreateWalletFundedBankTransferOrder: boolean;
}

export async function finalizeCheckoutPayment({
  clearCart,
  customerEmail,
  customerName,
  customerPhone,
  isOrderInFlight,
  orderNumber,
  orderResponse,
  runPostOrderSideEffects,
  selectedPayment,
  setIsProcessing,
  setPendingOrder,
  setShowCryptoSelection,
  shouldCreateWalletFundedBankTransferOrder,
}: FinalizeCheckoutPaymentParams) {
  if (selectedPayment === 'uba_redvault')
    throw new OrderError(
      'Review the server UBA summary before payment',
      'REDVAULT_REVIEW_REQUIRED'
    );
  const { order } = orderResponse;
  const fullyPaidStoreCreditPaymentMethod =
    getFullyPaidStoreCreditPaymentMethod(orderResponse);

  // Fully-paid orders route to success BEFORE any payment-method branch
  // (including Juicyway crypto): once nothing is due to the gateway, the
  // selected method is irrelevant and starting a payment flow for ₦0 is wrong.
  if (fullyPaidStoreCreditPaymentMethod) {
    await routeStoreCreditSuccess({
      clearCart,
      orderId: order.id,
      orderNumber,
      orderResponse,
      paymentMethod: fullyPaidStoreCreditPaymentMethod,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    isOrderInFlight.current = false;
    runPostOrderSideEffects();
    return;
  }

  // A quiz prize (voucher) order is pre-reserved and comes back already paid
  // with nothing due and no wallet/savings usage — so the store-credit check
  // above returns undefined. Route straight to success.
  if (
    order?.payment_status === 'paid' &&
    Number(orderResponse.amountDueToGateway ?? 0) <= 0
  ) {
    // routeFullyPaidPrizeSuccess reports the actual voucher method (not the
    // stale UI selection), so the success screen shows paid/completed copy.
    await routeFullyPaidPrizeSuccess({
      clearCart,
      isOrderInFlight,
      orderId: order.id,
      orderNumber,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    runPostOrderSideEffects();
    return;
  }

  if (selectedPayment === 'juicyway') {
    setPendingOrder({
      order,
      orderResponse,
      customerEmail,
      customerName,
      customerPhone,
      trackingToken: order.tracking_token || undefined,
    });
    setIsProcessing(false);
    isOrderInFlight.current = false;
    setShowCryptoSelection(true);
    runPostOrderSideEffects();
    return;
  }

  const isOnlinePayment =
    selectedPayment === 'paystack' || selectedPayment === 'korapay';
  const isBankTransfer = selectedPayment === 'bank_transfer';

  if (isOnlinePayment || isBankTransfer) {
    if (isBankTransfer && shouldCreateWalletFundedBankTransferOrder) {
      const startedWalletFundedBankTransfer =
        await startWalletFundedBankTransferCheckout({
          isOrderInFlight,
          orderId: order.id,
          orderNumber,
          setIsProcessing,
          trackingToken: order.tracking_token,
        });
      if (startedWalletFundedBankTransfer) {
        runPostOrderSideEffects();
        return;
      }
    }

    await initializeGatewayAndRoute({
      customerEmail,
      customerName,
      customerPhone,
      orderId: order.id,
      orderNumber,
      orderResponse,
      selectedPayment,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    isOrderInFlight.current = false;
    runPostOrderSideEffects();
    return;
  }

  await clearAndPersistCheckoutCart(clearCart);
  isOrderInFlight.current = false;
  router.replace({
    pathname: '/order-success',
    params: {
      orderId: order.id,
      orderNumber,
      paymentMethod: selectedPayment,
      ...(order.tracking_token && {
        trackingToken: order.tracking_token,
      }),
    },
  });
  runPostOrderSideEffects();
}

async function initializeGatewayAndRoute({
  customerEmail,
  customerName,
  customerPhone,
  orderId,
  orderNumber,
  orderResponse,
  selectedPayment,
  setIsProcessing,
  trackingToken,
}: {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  orderNumber: string;
  orderResponse: OrderResponse;
  selectedPayment: PaymentMethodType;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
  const isBankTransfer = selectedPayment === 'bank_transfer';
  const gateway = isBankTransfer ? 'paystack' : selectedPayment;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_INIT_TIMEOUT_MS);
  let initResponse: Response;
  try {
    initResponse = await fetch(
      `${CHECKOUT_API_BASE_URL}/api/payments/initialize`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `payment-init-${orderId}-${gateway}`,
        },
        body: JSON.stringify({
          merchant_id: CHECKOUT_MERCHANT_ID,
          order_id: orderId,
          currency: 'NGN',
          customer_email: customerEmail,
          customer_name: customerName,
          customer_phone: customerPhone,
          gateway,
          billing_address: { country: 'NG' },
          ...(isBankTransfer && { payment_type: 'dva' }),
        }),
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OrderError(
        'Payment initialization timed out',
        'PAYMENT_INIT_TIMEOUT'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let initData: PaymentInitializeData;
  try {
    initData = toPaymentInitializeData(await initResponse.json());
  } catch (error) {
    throw new OrderError(
      'Failed to parse payment initialization response',
      'PAYMENT_INIT_ERROR',
      error
    );
  }
  if (!initResponse.ok || !initData.success) {
    throw new OrderError(
      initData.error || 'Failed to initialize payment',
      'PAYMENT_INIT_ERROR'
    );
  }

  setIsProcessing(false);
  if (isBankTransfer) {
    router.push({
      pathname: '/bank-transfer',
      params: {
        orderId,
        orderNumber,
        reference: initData.reference,
        amount: String(orderResponse.amountDueToGateway),
        bankName:
          initData.dva?.bank_name || initData.virtual_account?.bank_name || '',
        accountNumber:
          initData.dva?.account_number ||
          initData.virtual_account?.account_number ||
          '',
        accountName:
          initData.dva?.account_name ||
          initData.virtual_account?.account_name ||
          '',
        ...(trackingToken && { trackingToken }),
      },
    });
    return;
  }

  router.push({
    pathname: '/payment-gateway',
    params: {
      orderId,
      orderNumber,
      gateway,
      authorizationUrl: initData.authorization_url || initData.checkout_url,
      reference: initData.reference,
      amount: String(orderResponse.amountDueToGateway),
      ...(trackingToken && { trackingToken }),
    },
  });
}
