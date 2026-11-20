import { requestDvaInitialization } from '@/components/storefront/ogabassey/pages/checkout/checkout-page-data-loaders';

export interface ChatwootCheckoutBank {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120;

/**
 * Starts the Paystack dedicated-account (bank transfer) payment through the
 * store checkout's own request. The shopper-visible failure is bounded: the
 * server's message is never surfaced.
 */
export async function initializeChatwootCheckoutBankTransfer(input: {
  merchantId: string;
  orderId: string;
  trackingToken: string | null;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  address: { line1: string; city: string; state: string };
}): Promise<{ bank: ChatwootCheckoutBank; reference: string } | null> {
  try {
    const { dva, reference } = await requestDvaInitialization({
      merchantId: input.merchantId,
      orderId: input.orderId,
      customerEmail: input.customer.email,
      customerName:
        `${input.customer.firstName} ${input.customer.lastName}`.trim(),
      customerPhone: input.customer.phone,
      billingAddress: {
        line1: input.address.line1,
        city: input.address.city,
        state: input.address.state,
        country: 'NG',
      },
      orderCurrency: 'NGN',
      trackingToken: input.trackingToken,
    });
    if (
      !nonEmpty(dva?.bank_name) ||
      !nonEmpty(dva?.account_number) ||
      !nonEmpty(dva?.account_name) ||
      !nonEmpty(reference)
    ) {
      return null;
    }
    return {
      bank: {
        bankName: dva.bank_name,
        accountNumber: dva.account_number,
        accountName: dva.account_name,
      },
      reference,
    };
  } catch {
    return null;
  }
}
