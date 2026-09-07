import { cryptoInitializationResponseSchema } from '@/schemas/crypto-initialization-response';
import { cryptoAddressStatusSchema } from '@/schemas/crypto-address-status';
import { readPaymentResponse } from './read-payment-response';
import type { CryptoInitialization } from './request-crypto-payment-initialization';

/** Address lookup never initializes a replacement payment session. */
export async function pollCryptoPaymentAddress(session: CryptoInitialization): Promise<CryptoInitialization> {
  if (!session.session_id) {
    throw new Error('Crypto payment session is unavailable. Please contact support.');
  }
  const query = new URLSearchParams({
    gateway: 'juicyway', session_id: session.session_id, check_address: 'true',
  });
  if (session.crypto_payment.payment_id) query.set('payment_id', session.crypto_payment.payment_id);
  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    const response = await fetch(`/api/payments/status?${query}`);
    const parsedStatus = cryptoAddressStatusSchema.safeParse(await readPaymentResponse(response));
    if (!parsedStatus.success) {
      throw new Error('Crypto payment status is unavailable. Retry to check the same payment session.');
    }
    const status = parsedStatus.data;
    if (status.crypto_address) {
      const address = status.crypto_address;
      if (address.chain !== session.crypto_payment.chain || address.currency !== session.crypto_payment.currency) {
        throw new Error('Crypto payment network does not match the selected network.');
      }
      const payment = cryptoInitializationResponseSchema.safeParse({
        ...session, crypto_address_pending: false,
        crypto_payment: { ...session.crypto_payment, ...address },
      });
      if (!payment.success) {
        throw new Error('Crypto payment details are unavailable. Retry to check the same payment session.');
      }
      return payment.data;
    }
  }
  throw new Error('Your crypto address is still being generated. Retry to check the same payment session.');
}
