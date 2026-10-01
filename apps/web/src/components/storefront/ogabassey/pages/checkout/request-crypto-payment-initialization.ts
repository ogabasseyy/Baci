import type { z } from 'zod';
import { pollCryptoPaymentAddress } from './poll-crypto-payment-address';
import type {
  CryptoChain,
  CryptoCurrency,
  CryptoPaymentData,
  PendingCryptoOrder,
} from './types';
import { readPaymentResponse } from './read-payment-response';
import { cryptoInitializationResponseSchema } from '@/schemas/crypto-initialization-response';

export type CryptoInitialization = z.infer<typeof cryptoInitializationResponseSchema>;

interface RequestCryptoPaymentInitializationParams {
  signal?: AbortSignal;
  onTerminalSession?: () => void;
  pendingSession?: CryptoInitialization;
  onPendingSession?: (session: CryptoInitialization) => void;
  merchantId: string;
  pendingOrder: PendingCryptoOrder;
  chain: CryptoChain;
  currency: CryptoCurrency;
  /** Merchant-resolved fiat order currency (server derives from order). */
  orderCurrency: string;
}

export async function requestCryptoPaymentInitialization({
  signal,
  onTerminalSession,
  pendingSession,
  onPendingSession,
  merchantId,
  pendingOrder,
  chain,
  currency,
  orderCurrency,
}: RequestCryptoPaymentInitializationParams): Promise<CryptoPaymentData> {
  let paymentData: unknown = pendingSession;
  if (!paymentData) {
    const paymentResponse = await fetch('/api/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: merchantId,
        order_id: pendingOrder.orderId,
        currency: orderCurrency,
        customer_email: pendingOrder.customerEmail,
        customer_name: pendingOrder.customerName,
        customer_phone: pendingOrder.customerPhone,
        gateway: 'juicyway',
        billing_address: pendingOrder.billingAddress,
        items: pendingOrder.items,
        crypto_chain: chain,
        crypto_currency: currency,
      }),
    });

    paymentData = await readPaymentResponse(paymentResponse);
  }

  const paymentResult = cryptoInitializationResponseSchema.safeParse(
    paymentData
  );

  if (!paymentResult.success) {
    throw new Error('Crypto payment details are unavailable. Please choose another payment method.');
  }
  let payment = paymentResult.data;
  if (
    payment.crypto_payment.chain !== chain ||
    payment.crypto_payment.currency !== currency
  ) {
    throw new Error('Crypto payment network does not match the selected network.');
  }
  // Preserve a completed POST even if the selector closed while it was in flight.
  onPendingSession?.(payment);
  signal?.throwIfAborted();
  if (pendingSession || (payment.crypto_address_pending && !payment.crypto_payment.address)) {
    payment = await pollCryptoPaymentAddress(payment, { signal, onTerminalSession });
  }
  if (payment.success && payment.crypto_payment) {
    return {
      address: payment.crypto_payment.address,
      chain: payment.crypto_payment.chain,
      currency: payment.crypto_payment.currency,
      amount: Number(payment.crypto_payment.crypto_amount),
      confirmation_time: payment.crypto_payment.confirmation_time,
      orderId: pendingOrder.orderId,
      trackingToken: pendingOrder.trackingToken,
      reference: payment.reference,
      sessionId: payment.session_id || '',
      paymentId: payment.crypto_payment.payment_id || '', // Payment ID for verification
      qrcode: payment.crypto_payment.qrcode,
    };
  }

  throw new Error('Failed to generate crypto payment address');
}
