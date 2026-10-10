import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { DEFAULT_TIMEOUT, fetchWithTimeout } from '@/lib/fetch-with-timeout';
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
  }
) {
  const accessToken = await getAccessToken();
  const { idempotencyKey, ...rest } = payload;
  const normalized = normalizeVtuCheckoutPayload(rest);
  const response = await fetchWithTimeout(VTU_CHECKOUT_WALLET_ONLY_URL, {
    method: 'POST',
    timeout: DEFAULT_TIMEOUT,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...normalized,
      merchantSlug: CONFIG.MERCHANT_SLUG,
    }),
  });

  const data = await parseJsonResponse(response);
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
  const response = await fetchWithTimeout(
    `${API_URL}/api/vtu/checkout/confirm`,
    {
      method: 'POST',
      timeout: DEFAULT_TIMEOUT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gateway,
        merchantSlug: CONFIG.MERCHANT_SLUG,
        reference,
      }),
    }
  );

  const data = (await response.json()) as Record<string, unknown>;
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
