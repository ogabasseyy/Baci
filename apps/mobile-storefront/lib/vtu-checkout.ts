import {
  fetchJsonWithDeadline,
  VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER,
} from '@baci/shared';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import {
  DEFAULT_TIMEOUT,
  fetchWithTimeout,
  HttpError,
} from '@/lib/fetch-with-timeout';
import { adoptCanonicalVtuKey } from './pending-vtu-idempotency';
import {
  getAccessToken,
  getResponseErrorMessage,
  normalizeConfirmCheckoutStatus,
  normalizeVtuCheckoutPayload,
  parseJsonResponse,
} from './vtu-checkout-helpers';
import {
  ConfirmCheckoutResponseSchema,
  SavedCardsResponseSchema,
  type VTUCheckoutPayload,
  type VtuCheckoutConfirmation,
  type VtuConfirmationGateway,
  WalletOnlyVtuResponseSchema,
} from './vtu-checkout-response-schemas';

export {
  creditedVtuCashback,
  normalizeVtuCheckoutPayload,
  shouldRotateWalletIdempotencyKeyForError,
} from './vtu-checkout-helpers';
export type {
  SavedVtuCard,
  VTUCheckoutPayload,
  VtuCheckoutConfirmation,
  VtuConfirmationGateway,
  WalletOnlyVtuResult,
} from './vtu-checkout-response-schemas';

const API_URL = EXPO_PUBLIC_API_URL;
export const VTU_CHECKOUT_WALLET_ONLY_URL = `${API_URL}/api/vtu/checkout/wallet-only`;

export class VtuPaymentStillProcessingError extends Error {
  amount?: number;
  customerIdentifier?: string;
  reference: string;

  constructor({
    amount,
    customerIdentifier,
    reference,
  }: {
    amount?: number;
    customerIdentifier?: string;
    reference: string;
  }) {
    super('Payment is still processing. Check your utility history shortly.');
    this.name = 'VtuPaymentStillProcessingError';
    Object.setPrototypeOf(this, VtuPaymentStillProcessingError.prototype);
    this.amount = amount;
    this.customerIdentifier = customerIdentifier;
    this.reference = reference;
  }
}

export async function chargeWalletForVtu(
  payload: VTUCheckoutPayload & {
    walletAmount: number;
    idempotencyKey: string;
    /**
     * Auth user id captured by the handler before dispatch. When
     * provided, the acquired token must belong to this user or the
     * checkout aborts before any POST — otherwise a mid-flight
     * account switch would debit the wrong customer's wallet. Also
     * sent in the body so the route's 409 guard backstops both
     * clients identically.
     */
    expectedUserId?: string | null;
    /**
     * Registry descriptor for the minted entry. When the server
     * joins this submit onto another key's in-flight transaction
     * (intent claim), the entry rebinds to the winner key so
     * retries replay instead of re-preparing per attempt.
     */
    pendingDescriptor?: string;
  }
) {
  const { expectedUserId, idempotencyKey, pendingDescriptor, ...rest } =
    payload;
  const accessToken = await getAccessToken(expectedUserId, {
    requireSubmitterBinding: true,
  });
  const normalized = normalizeVtuCheckoutPayload(rest);
  // One shared deadline for headers + body (Codex R77 6sNGOy):
  // fetchWithTimeout resolves on headers, so a stalled body used to
  // hang the submitting guard forever even after the debit landed.
  // fetchJsonWithDeadline aborts the fetch itself on expiry.
  const deadlineMs = Date.now() + DEFAULT_TIMEOUT;
  const { data, response } = await fetchJsonWithDeadline<
    Record<string, unknown>
  >(VTU_CHECKOUT_WALLET_ONLY_URL, {
    body: JSON.stringify({
      ...normalized,
      ...(expectedUserId ? { expectedUserId } : {}),
      merchantSlug: CONFIG.MERCHANT_SLUG,
    }),
    deadlineMs,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    method: 'POST',
  });
  // Winner-key adoption (intent-claim join), BEFORE branching on
  // outcome: retained-key retries on any path must replay the
  // winner, not re-prepare + orphan per attempt. Terminal paths
  // forget right after, so the rebind is harmless there.
  const canonicalKey =
    response.headers.get(VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER) ?? undefined;
  if (canonicalKey && pendingDescriptor) {
    // Awaited (Codex R1 P1): the winner key must be durable
    // before this response resolves — a restart on a scheduled-
    // only flush would resurrect the loser key and double-debit
    // once the winner terminalizes.
    await adoptCanonicalVtuKey(pendingDescriptor, canonicalKey);
  }
  if (!response.ok) {
    throw new HttpError(response.status, getResponseErrorMessage(data));
  }

  return WalletOnlyVtuResponseSchema.parse({
    ...data,
    status: normalizeConfirmCheckoutStatus(data.status),
  });
}

export async function confirmVtuCheckout({
  gateway,
  reference,
}: {
  gateway: VtuConfirmationGateway;
  reference: string;
}) {
  const accessToken = await getAccessToken();
  // Shared headers+body deadline (Codex R77 6sNGOy): the history-sync
  // guard held across this call must not hang on a stalled body.
  const deadlineMs = Date.now() + DEFAULT_TIMEOUT;
  const { data, response } = await fetchJsonWithDeadline<
    Record<string, unknown>
  >(`${API_URL}/api/vtu/checkout/confirm`, {
    body: JSON.stringify({
      gateway,
      merchantSlug: CONFIG.MERCHANT_SLUG,
      reference,
    }),
    deadlineMs,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const gatewayStatus =
      typeof data.status === 'string' ? data.status.toLowerCase() : '';
    if (
      response.status === 409 &&
      gatewayStatus !== 'failed' &&
      gatewayStatus !== 'abandoned'
    ) {
      return ConfirmCheckoutResponseSchema.parse({
        ...data,
        reference,
        status: 'processing' as const,
      });
    }

    throw new Error(getResponseErrorMessage(data));
  }

  return ConfirmCheckoutResponseSchema.parse({
    ...data,
    status: normalizeConfirmCheckoutStatus(data.status),
  });
}

export async function waitForVtuConfirmation({
  gateway,
  maxAttempts = 10,
  reference,
}: {
  gateway: VtuConfirmationGateway;
  maxAttempts?: number;
  reference: string;
}) {
  let lastProcessingResult: VtuCheckoutConfirmation | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await confirmVtuCheckout({ gateway, reference });
    if (result.status === 'successful') {
      return result;
    }

    lastProcessingResult = result;
    if (attempt < maxAttempts - 1) {
      const delayMs = Math.min(1200 + attempt * 300, 4000);
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  throw new VtuPaymentStillProcessingError({
    amount: lastProcessingResult?.amount,
    customerIdentifier: lastProcessingResult?.customerIdentifier,
    reference: lastProcessingResult?.reference ?? reference,
  });
}

export async function listSavedVtuCards({
  signal,
}: {
  signal?: AbortSignal;
} = {}) {
  const accessToken = await getAccessToken();
  const response = await fetchWithTimeout(
    `${API_URL}/api/vtu/checkout/saved-cards?merchantSlug=${encodeURIComponent(CONFIG.MERCHANT_SLUG)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
      timeout: DEFAULT_TIMEOUT,
    }
  );

  const data = await parseJsonResponse(response);
  return SavedCardsResponseSchema.parse(data).cards;
}
