import {
  DEFAULT_FETCH_TIMEOUT_MESSAGE,
  DEFAULT_FETCH_TIMEOUT_MS,
  isAbortError,
  VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER,
  withDeadline,
} from '@baci/shared/lib';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  getCheckoutErrorMessage,
  isUtilityCheckoutResponse,
  isWalletOnlySuccessResponse,
  parseUtilityCheckoutCashback,
  type UtilityCheckoutCashback,
  type UtilityCheckoutPayload,
} from './utility-checkout';
import { buildUtilityCheckoutWalletPayload } from './utility-checkout-wallet-payload';
import { buildVtuWalletPayloadSignature } from './utility-vtu-payload-signature';

export interface UtilityCheckoutRequest {
  payload: UtilityCheckoutPayload;
  merchantSlug: string;
  customerName: string;
  customerPhone: string | null | undefined;
  /** Auth user id captured before dispatch; the route rejects a mismatch. */
  expectedUserId: string | null | undefined;
  getWalletIdempotencyKey: (payloadSignature: string) => Promise<string>;
}

export type UtilityCheckoutResult =
  | {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
      cashback?: UtilityCheckoutCashback;
      voucherPin?: string;
      /** Winner key after an intent-claim join; adopt for retries. */
      canonicalIdempotencyKey?: string;
    }
  // `status` is the HTTP status when the server answered, and undefined for
  // network failures and malformed bodies. Callers rotate the idempotency
  // key only on terminal 4xx (mirroring mobile); anything else keeps the key
  // so a retry replays instead of double-charging.
  | {
      kind: 'error';
      message: string;
      status?: number;
      canonicalIdempotencyKey?: string;
    };

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
    const walletPayload = buildUtilityCheckoutWalletPayload({
      merchantSlug,
      customerName,
      customerPhone,
      expectedUserId,
      payload,
    });
    // One shared deadline for headers + body (Codex R70/R72,
    // R81 P2): fetchWithCsrf resolves on headers, so a stalled
    // body would otherwise hold loading/submitting forever even
    // after the debit landed. The CSRF-refresh retry inside
    // fetchWithCsrf shares the same signal, so it is bounded too.
    const deadlineMs = Date.now() + DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULT_FETCH_TIMEOUT_MS
    );
    let response: Response;
    let rawResponse: string;
    try {
      response = await fetchWithCsrf('/api/vtu/checkout/wallet-only', {
        method: 'POST',
        headers: {
          // Async (R149): the capture runs under the mint mutex.
          'Idempotency-Key': await getWalletIdempotencyKey(
            buildVtuWalletPayloadSignature(walletPayload)
          ),
        },
        body: JSON.stringify(walletPayload),
        signal: controller.signal,
      });
      rawResponse = await withDeadline(
        response.text(),
        deadlineMs,
        DEFAULT_FETCH_TIMEOUT_MESSAGE
      ).catch((error: unknown) => {
        // Release the connection: the race alone leaves the locked
        // body read pending, piling up abandoned downloads.
        controller.abort();
        throw error;
      });
    } catch (error) {
      // Real fetch aborts reject with a DOMException, not an
      // Error — match by name on both so the timeout message
      // (and key retention) holds on every runtime.
      const aborted =
        isAbortError(error) ||
        (error instanceof DOMException && error.name === 'AbortError');
      if (aborted) {
        throw new Error(DEFAULT_FETCH_TIMEOUT_MESSAGE);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    // Winner-key wire (intent-claim join): the caller adopts this
    // key for retries so attempts converge on one key. Present on
    // joins regardless of outcome; absent otherwise.
    const canonicalIdempotencyKey =
      response.headers.get(VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER) ?? undefined;
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
          ...(canonicalIdempotencyKey ? { canonicalIdempotencyKey } : {}),
        };
      }
      throw new Error('Payment checkout returned an invalid response');
    }
    if (!response.ok) {
      return {
        kind: 'error',
        message: getCheckoutErrorMessage(parsedData),
        status: response.status,
        ...(canonicalIdempotencyKey ? { canonicalIdempotencyKey } : {}),
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
      ...(canonicalIdempotencyKey ? { canonicalIdempotencyKey } : {}),
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Something went wrong',
    };
  }
};
