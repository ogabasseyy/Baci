interface CryptoPaymentMetadata {
  conversion_rate?: number;
  currency: string;
  expected_session_amount?: number;
  expected_session_currency?: string;
}

/** Persist gateway evidence alongside the transaction before a webhook can arrive. */
export function initializeTransactionMetadata({
  gateway,
  paymentType,
  cryptoPayment,
}: {
  gateway: string;
  paymentType?: string;
  cryptoPayment?: CryptoPaymentMetadata;
}): Record<string, unknown> {
  if (
    gateway === 'juicyway' &&
    cryptoPayment?.expected_session_amount != null
  ) {
    return {
      juicyway_expected_amount: cryptoPayment.expected_session_amount,
      juicyway_expected_currency:
        cryptoPayment.expected_session_currency ?? cryptoPayment.currency,
      juicyway_fx_rate: cryptoPayment.conversion_rate ?? null,
    };
  }

  return gateway === 'paystack' && paymentType === 'dva'
    ? { paystack_payment_type: 'dva' }
    : {};
}
