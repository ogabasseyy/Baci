import { cryptoInitializationResponseSchema } from '@/schemas/crypto-initialization-response';
import { cryptoAddressStatusSchema } from '@/schemas/crypto-address-status';
import { readPaymentResponse } from './read-payment-response';
import type { CryptoInitialization } from './request-crypto-payment-initialization';

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 2000);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Address lookup never initializes a replacement payment session. */
export async function pollCryptoPaymentAddress(session: CryptoInitialization, options: { signal?: AbortSignal; onTerminalSession?: () => void } = {}): Promise<CryptoInitialization> {
  if (!session.session_id) {
    throw new Error('Crypto payment session is unavailable. Please contact support.');
  }
  const query = new URLSearchParams({
    gateway: 'juicyway', session_id: session.session_id, check_address: 'true',
  });
  if (session.crypto_payment.payment_id) query.set('payment_id', session.crypto_payment.payment_id);
  for (let attempt = 0; attempt < 15; attempt++) {
    options.signal?.throwIfAborted();
    if (attempt > 0) await waitForNextPoll(options.signal);
    const response = await fetch(`/api/payments/status?${query}`, { signal: options.signal });
    const parsedStatus = cryptoAddressStatusSchema.safeParse(await readPaymentResponse(response));
    options.signal?.throwIfAborted();
    if (!parsedStatus.success) {
      throw new Error('Crypto payment status is unavailable. Retry to check the same payment session.');
    }
    const status = parsedStatus.data;
    // Paid sessions can still include the deposit address; never present them as payable.
    if (['succeeded', 'confirmed', 'success'].includes(status.status ?? '')) {
      options.onTerminalSession?.();
      throw new Error('This crypto payment has already been completed.');
    }
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(status.status ?? '')) {
      options.onTerminalSession?.();
      throw new Error('This crypto payment session has ended. Retry to create a new payment session.');
    }
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
