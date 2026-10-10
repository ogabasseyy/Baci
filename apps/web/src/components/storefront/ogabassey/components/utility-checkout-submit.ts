import { fetchWithCsrf } from '@/lib/api-client';
import {
  getCheckoutErrorMessage,
  isUtilityCheckoutResponse,
  type UtilityCheckoutPayload,
} from './utility-checkout';

export interface UtilityCheckoutRequest {
  payload: UtilityCheckoutPayload;
  merchantSlug: string;
  customerName: string;
  customerPhone: string | null | undefined;
  getWalletIdempotencyKey: (payloadSignature: string) => string;
}

export type UtilityCheckoutResult =
  | {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
    }
  | { kind: 'error'; message: string };

/**
 * Module-scope helper: keeps try/finally + throw-in-try out of the component
 * body so React Compiler can memoize the caller. Extracted from `UtilityModal`
 * to keep that component under the 300-line modularity budget.
 *
 * Wallet-only: utilities are always charged to wallet balance. Callers must
 * verify the balance covers the bill before submitting (the wallet-only route
 * rejects partial coverage).
 */
export const submitUtilityCheckout = async ({
  payload,
  merchantSlug,
  customerName,
  customerPhone,
  getWalletIdempotencyKey,
}: UtilityCheckoutRequest): Promise<UtilityCheckoutResult> => {
  try {
    const walletPayload = {
      merchantSlug,
      customerName,
      ...(customerPhone ? { customerPhone } : {}),
      ...payload,
      walletAmount: payload.amount,
    };
    const response = await fetchWithCsrf('/api/vtu/checkout/wallet-only', {
      method: 'POST',
      headers: {
        'Idempotency-Key': getWalletIdempotencyKey(
          JSON.stringify(walletPayload)
        ),
      },
      body: JSON.stringify(walletPayload),
    });

    const rawResponse = await response.text();
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(rawResponse);
    } catch {
      throw new Error(
        response.ok
          ? 'Payment checkout returned an invalid response'
          : `Payment checkout failed (${response.status})`
      );
    }
    if (!response.ok) throw new Error(getCheckoutErrorMessage(parsedData));
    if (!isUtilityCheckoutResponse(parsedData)) {
      throw new Error('Payment checkout returned an invalid response');
    }
    const data = parsedData;

    return {
      kind: 'wallet-success',
      reference: data.reference ?? '',
      amount: data.amount ?? payload.amount,
      processing: data.status === 'processing',
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Something went wrong',
    };
  }
};
