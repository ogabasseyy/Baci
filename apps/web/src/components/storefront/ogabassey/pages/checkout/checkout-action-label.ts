import type { PaymentMethod, PaymentTab } from './types';

/** Keep desktop and mobile checkout actions consistent across providers. */
export function getCheckoutActionLabel(
  paymentTab: PaymentTab,
  paymentMethod: PaymentMethod
): string {
  if (paymentTab === 'installments') return 'Begin Process';
  if (paymentMethod === 'invoice') return 'Generate Invoice';
  if (paymentMethod === 'payforme') return 'Send Payment Link';
  return 'Place Order';
}
