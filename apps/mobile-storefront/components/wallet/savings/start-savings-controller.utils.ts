import type {
  SavingsProductChoice,
  SavingsSourceMode,
} from './start-savings.types';

export {
  applyStartSavingsProductSelection,
  getSavingsVariantOptions,
  hasSelectableVariants,
  isSavingsVariantSelectable,
  toProductChoice,
  toSelectedProductChoice,
} from './start-savings-product-choice';

type ErrorWithCode = Error & { code?: string };
export const INSUFFICIENT_WALLET_ERROR_CODE = 'INSUFFICIENT_WALLET_BALANCE';
const INSUFFICIENT_WALLET_MESSAGE_PATTERN =
  /\binsufficient\s+wallet(?:\s+(?:balance|funds?))?\b/i;

type SavingsProviderCapabilities = {
  supportsInitialContributionWithAutoDebit: boolean;
};

// Provider keys map to savings setup capabilities. When another provider is
// supported, add it here and set supportsInitialContributionWithAutoDebit to
// match whether mandate setup can also collect the initial contribution.
const PROVIDER_CAPABILITIES: Record<string, SavingsProviderCapabilities> = {
  paystack: { supportsInitialContributionWithAutoDebit: false },
};

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export function readParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const GOAL_IDEMPOTENCY_MISMATCH_PATTERN =
  /\bmismatched_goal_idempotency_payload\b/;

export function isGoalIdempotencyMismatchError(error: unknown) {
  return GOAL_IDEMPOTENCY_MISMATCH_PATTERN.test(getErrorMessage(error, ''));
}

// Prefer backend error codes; the message fallback is intentionally narrow for
// older/provider errors until all savings errors are normalized to codes.
export function isInsufficientWalletError(error: unknown) {
  if (isErrorWithCode(error)) {
    return error.code === INSUFFICIENT_WALLET_ERROR_CODE;
  }
  return INSUFFICIENT_WALLET_MESSAGE_PATTERN.test(getErrorMessage(error, ''));
}

function supportsInitialContributionWithAutoDebit(paymentProvider: string) {
  return (
    PROVIDER_CAPABILITIES[paymentProvider]
      ?.supportsInitialContributionWithAutoDebit ?? false
  );
}

export function validateStartSavingsForm({
  acceptsNonWithdrawableTerms,
  contributionValue,
  initialContributionEnabled,
  initialContributionValue,
  paymentProvider,
  selectedProduct,
  sourceMode,
  targetValue,
}: {
  acceptsNonWithdrawableTerms: boolean;
  contributionValue: number;
  initialContributionEnabled: boolean;
  initialContributionValue: number;
  paymentProvider: string;
  selectedProduct: SavingsProductChoice | null;
  sourceMode: SavingsSourceMode;
  targetValue: number;
}) {
  if (!selectedProduct) {
    return 'Select the product you want to save for.';
  }
  if (
    selectedProduct.requiresVariantSelection !== false ||
    (selectedProduct.variantId !== null &&
      (typeof selectedProduct.variantId !== 'string' ||
        !selectedProduct.variantId.trim()))
  ) {
    return 'Select the exact device variant you want to save for.';
  }
  if (targetValue <= 0) {
    return 'Enter a valid target amount.';
  }
  if (contributionValue <= 0) {
    return 'Enter a valid contribution amount.';
  }
  if (initialContributionEnabled && initialContributionValue <= 0) {
    return 'Enter your initial contribution amount.';
  }
  // Provider capability: Paystack auto-debit setup creates the mandate first;
  // providers must opt in before combining mandate setup and upfront funding.
  if (
    sourceMode === 'auto_debit' &&
    initialContributionEnabled &&
    !supportsInitialContributionWithAutoDebit(paymentProvider)
  ) {
    return 'Initial contributions are only supported with manual debit for now.';
  }
  if (!acceptsNonWithdrawableTerms) {
    return 'You must accept the non-withdrawable savings terms.';
  }
  return null;
}
