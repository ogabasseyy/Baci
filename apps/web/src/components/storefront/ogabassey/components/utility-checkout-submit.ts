import { fetchWithCsrf } from '@/lib/api-client';
import {
  getCheckoutErrorMessage,
  isUtilityCheckoutResponse,
  isWalletOnlySuccessResponse,
  parseUtilityCheckoutCashback,
  type UtilityCheckoutCashback,
  type UtilityCheckoutPayload,
} from './utility-checkout';
import { buildVtuWalletPayloadSignature } from './utility-vtu-payload-signature';

export interface UtilityCheckoutRequest {
  payload: UtilityCheckoutPayload;
  merchantSlug: string;
  customerName: string;
  customerPhone: string | null | undefined;
  /** Auth user id captured before dispatch; the route rejects a mismatch. */
  expectedUserId: string | null | undefined;
  getWalletIdempotencyKey: (payloadSignature: string) => string;
}

export type UtilityCheckoutResult =
  | {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
      cashback?: UtilityCheckoutCashback;
      voucherPin?: string;
    }
  // `status` is the HTTP status when the server answered, and undefined for
  // network failures and malformed bodies. Callers rotate the idempotency
  // key only on terminal 4xx (mirroring mobile); anything else keeps the key
  // so a retry replays instead of double-charging.
  | { kind: 'error'; message: string; status?: number };

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
  expectedUserId,
  getWalletIdempotencyKey,
}: UtilityCheckoutRequest): Promise<UtilityCheckoutResult> => {
  try {
    const walletPayload = {
      merchantSlug,
      customerName,
      ...(customerPhone ? { customerPhone } : {}),
      ...(expectedUserId ? { expectedUserId } : {}),
      ...payload,
      walletAmount: payload.amount,
    };
    const response = await fetchWithCsrf('/api/vtu/checkout/wallet-only', {
      method: 'POST',
      headers: {
        'Idempotency-Key': getWalletIdempotencyKey(
          buildVtuWalletPayloadSignature(walletPayload)
        ),
      },
      body: JSON.stringify(walletPayload),
    });

    const rawResponse = await response.text();
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(rawResponse);
    } catch {
      // Non-JSON body. A failed status is still the server answering, so
      // preserve it for the caller's rotation decision; an OK status with a
      // non-JSON body is ambiguous (the debit may have landed).
      if (!response.ok) {
        return {
          kind: 'error',
          message: `Payment checkout failed (${response.status})`,
          status: response.status,
        };
      }
      throw new Error('Payment checkout returned an invalid response');
    }
    if (!response.ok) {
      return {
        kind: 'error',
        message: getCheckoutErrorMessage(parsedData),
        status: response.status,
      };
    }
    if (!isUtilityCheckoutResponse(parsedData)) {
      throw new Error('Payment checkout returned an invalid response');
    }
    if (!isWalletOnlySuccessResponse(parsedData)) {
      // 2xx without a reference + successful|processing status: the
      // debit may have committed, so this MUST NOT finalize success
      // (which forgets the key — a retry would mint fresh and
      // double-charge). Ambiguous error keeps the key for replay.
      throw new Error('Payment checkout returned an invalid response');
    }
    const data = parsedData;
    const cashback = parseUtilityCheckoutCashback(data.cashback);

    return {
      kind: 'wallet-success',
      reference: data.reference ?? '',
      amount: data.amount ?? payload.amount,
      processing: data.status === 'processing',
      ...(cashback ? { cashback } : {}),
      ...(data.voucherPin ? { voucherPin: data.voucherPin } : {}),
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Something went wrong',
    };
  }
};
