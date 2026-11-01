import {
  filterRuntimeImeiTierKeys,
  type ImeiBrandFilter,
  type ImeiServiceTierKey,
  isConfirmedImeiRefund,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';

export const DEFAULT_IMEI_CHECK_ERROR_MESSAGE =
  'Unable to check IMEI. Please try again.';

type ResolveImeiCheckFailureInput = {
  currentTierPrice: number;
  payload: unknown;
  responseStatus: number;
  walletBalance: number;
};

type ResolveImeiCheckFailureOutcome = {
  errorMessage: string | null;
  shouldClearIdempotencyKey: boolean;
  shouldPreserveIdempotencyKey: boolean;
  shouldRefetchWallet: boolean;
  shouldRedirectToLogin: boolean;
  topUpAmount: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

function getNumericFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCode(payload: Record<string, unknown>): string | null {
  return typeof payload.code === 'string' ? payload.code : null;
}

function getErrorMessage(payload: Record<string, unknown>): string | null {
  return typeof payload.error === 'string' ? payload.error : null;
}

export function resolveImeiCheckFailure(
  input: ResolveImeiCheckFailureInput
): ResolveImeiCheckFailureOutcome {
  const payload = asRecord(input.payload);
  const code = getCode(payload);
  const errorMessage = getErrorMessage(payload);
  // Only a confirmed no-debit or refunded terminal response may retire a key.
  // Authentication and intermediary errors can follow an earlier uncertain POST.
  const shouldClearIdempotencyKey =
    (input.responseStatus === 402 && code === 'WALLET_INSUFFICIENT') ||
    (input.responseStatus === 500 && code === 'IMEI_NO_DEBIT') ||
    isConfirmedImeiRefund(input.responseStatus, code);
  const shouldPreserveIdempotencyKey = !shouldClearIdempotencyKey;

  if (input.responseStatus === 401) {
    return {
      errorMessage: null,
      shouldClearIdempotencyKey: false,
      shouldPreserveIdempotencyKey: true,
      shouldRefetchWallet: false,
      shouldRedirectToLogin: true,
      topUpAmount: null,
    };
  }

  if (input.responseStatus === 402) {
    const required = getNumericFallback(
      payload.required,
      input.currentTierPrice
    );
    const balance = getNumericFallback(payload.balance, input.walletBalance);
    const topUpAmount = Math.max(0, required - balance);

    return {
      errorMessage: null,
      shouldClearIdempotencyKey,
      shouldPreserveIdempotencyKey,
      shouldRefetchWallet: false,
      shouldRedirectToLogin: false,
      topUpAmount,
    };
  }

  if (input.responseStatus === 404 && code === 'CUSTOMER_NOT_FOUND') {
    return {
      errorMessage:
        'Your customer profile is not ready for this store. Please sign in again.',
      shouldClearIdempotencyKey,
      shouldPreserveIdempotencyKey,
      shouldRefetchWallet: false,
      shouldRedirectToLogin: false,
      topUpAmount: null,
    };
  }

  if (input.responseStatus === 502 && code === 'REFUND_PENDING') {
    return {
      errorMessage:
        'Lookup failed; your refund is pending. We will credit you within 24h.',
      shouldClearIdempotencyKey,
      shouldPreserveIdempotencyKey,
      shouldRefetchWallet: true,
      shouldRedirectToLogin: false,
      topUpAmount: null,
    };
  }

  if (
    (input.responseStatus === 404 &&
      (code === 'SICKW_NOT_FOUND' || code === 'PETROCK_REJECTED')) ||
    (input.responseStatus === 502 && code === 'SICKW_UNAVAILABLE')
  ) {
    return {
      errorMessage: 'Lookup failed; your wallet was refunded.',
      shouldClearIdempotencyKey,
      shouldPreserveIdempotencyKey,
      shouldRefetchWallet: true,
      shouldRedirectToLogin: false,
      topUpAmount: null,
    };
  }

  return {
    errorMessage: errorMessage ?? DEFAULT_IMEI_CHECK_ERROR_MESSAGE,
    shouldClearIdempotencyKey,
    shouldPreserveIdempotencyKey,
    shouldRefetchWallet: false,
    shouldRedirectToLogin: false,
    topUpAmount: null,
  };
}

const PUBLIC_IMEI_SERVICE_TIER_KEYS = new Set<ImeiServiceTierKey>(
  PUBLIC_IMEI_SERVICE_TIERS
);

export function getPublicVisibleImeiServiceTierKeys(
  getVisibleTiers: (
    brand: ImeiBrandFilter,
    expanded: boolean
  ) => ImeiServiceTierKey[],
  brand: ImeiBrandFilter,
  expanded: boolean,
  availableTierKeys: readonly ImeiServiceTierKey[] | null = null
): ImeiServiceTierKey[] {
  const visible = filterRuntimeImeiTierKeys(
    getVisibleTiers(brand, expanded).filter((tierKey) =>
      PUBLIC_IMEI_SERVICE_TIER_KEYS.has(tierKey)
    ),
    availableTierKeys
  );
  return !expanded && visible.length === 0
    ? getPublicVisibleImeiServiceTierKeys(
        getVisibleTiers,
        brand,
        true,
        availableTierKeys
      )
    : visible;
}

export function hasAdditionalPublicImeiServiceTierKeys(
  getVisibleTiers: (
    brand: ImeiBrandFilter,
    expanded: boolean
  ) => ImeiServiceTierKey[],
  brand: ImeiBrandFilter,
  availableTierKeys: readonly ImeiServiceTierKey[] | null = null
): boolean {
  const collapsedKeys = getPublicVisibleImeiServiceTierKeys(
    getVisibleTiers,
    brand,
    false,
    availableTierKeys
  );
  const expandedKeys = getPublicVisibleImeiServiceTierKeys(
    getVisibleTiers,
    brand,
    true,
    availableTierKeys
  );

  return expandedKeys.some((tierKey) => !collapsedKeys.includes(tierKey));
}
