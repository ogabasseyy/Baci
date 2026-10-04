import type { Dispatch, SetStateAction } from 'react';
import type { Product, ProductVariant } from '@/types/product';
import {
  formatProductConditionDisplay,
  formatVariantAxisLabel,
} from '@/types/product';
import type {
  SavingsProductChoice,
  SavingsSourceMode,
} from './start-savings.types';

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

export function toProductChoice(product: Product): SavingsProductChoice {
  const storageValues = getProductStorageValues(product);

  return {
    conditionLabel: formatProductConditionDisplay(product.condition) ?? null,
    id: product.id,
    image: product.image,
    name: product.name,
    price: product.searchPreview ? 0 : product.price,
    requiresVariantSelection:
      !!product.searchPreview || hasSelectableVariants(product),
    slug: product.slug,
    variantId: null,
    variantLabel:
      storageValues.length > 0
        ? `Storage: ${formatCompactValues(storageValues)}`
        : null,
  };
}

export function applyStartSavingsProductSelection({
  product,
  previousSelectedProduct,
  setFormError,
  setSearchValue,
  setSelectedProduct,
  setTargetAmount,
  variantId,
}: {
  product: Product;
  previousSelectedProduct?: SavingsProductChoice | null;
  setFormError?: (error: string | null) => void;
  setSearchValue: (value: string) => void;
  setSelectedProduct: (choice: SavingsProductChoice | null) => void;
  setTargetAmount?: Dispatch<SetStateAction<string>>;
  variantId?: string | null;
}) {
  const choice = toSelectedProductChoice({ product, variantId });
  const nextAutoTargetAmount = choice.requiresVariantSelection
    ? ''
    : String(Math.round(choice.price));
  const previousAutoTargetAmount = previousSelectedProduct
    ? String(Math.round(previousSelectedProduct.price))
    : '';
  setFormError?.(null);
  setSelectedProduct(choice);
  setSearchValue(product.name);
  setTargetAmount?.((currentTargetAmount) => {
    const normalizedCurrentTargetAmount = currentTargetAmount.trim();
    if (
      !normalizedCurrentTargetAmount ||
      normalizedCurrentTargetAmount === previousAutoTargetAmount
    ) {
      return nextAutoTargetAmount;
    }
    return currentTargetAmount;
  });
}

export function toSelectedProductChoice({
  product,
  variantId,
}: {
  product: Product;
  variantId?: string | null;
}): SavingsProductChoice {
  const selectedVariant = variantId
    ? product.variants?.find(
        (variant) =>
          variant.id === variantId && isSavingsVariantSelectable(variant)
      )
    : null;

  if (!selectedVariant) {
    if (variantId || hasSelectableVariants(product)) {
      return {
        conditionLabel:
          formatProductConditionDisplay(product.condition) ?? null,
        id: product.id,
        image: product.image,
        name: product.name,
        price: product.price,
        requiresVariantSelection: true,
        slug: product.slug,
        variantId: null,
        variantLabel: null,
      };
    }

    return toProductChoice(product);
  }

  const variantLabel = getVariantLabel(selectedVariant.attributes);

  return {
    conditionLabel:
      formatProductConditionDisplay(selectedVariant.condition) ??
      formatProductConditionDisplay(product.condition) ??
      null,
    id: product.id,
    image:
      [
        selectedVariant.image,
        ...(selectedVariant.images ?? []),
        product.image,
        ...(product.images ?? []),
      ]
        .find((image) => typeof image === 'string' && image.trim().length > 0)
        ?.trim() ?? '',
    name: product.name,
    price: selectedVariant.price,
    requiresVariantSelection: false,
    slug: product.slug,
    variantId: selectedVariant.id,
    variantLabel,
  };
}

export function hasSelectableVariants(product: Product) {
  return (product.variants?.length ?? 0) > 0;
}

export function isSavingsVariantSelectable(variant: ProductVariant) {
  return Number.isFinite(variant.price) && variant.price > 0;
}

export function getSavingsVariantOptions(product: Product) {
  return (product.variants ?? []).map((variant) => {
    const choice = toSelectedProductChoice({
      product,
      variantId: variant.id,
    });
    return {
      conditionLabel: choice.conditionLabel ?? null,
      id: variant.id,
      label: [choice.conditionLabel, choice.variantLabel ?? variant.name]
        .filter((value): value is string => Boolean(value))
        .join(' · '),
      price: choice.price,
      unavailable: !isSavingsVariantSelectable(variant),
    };
  });
}

function formatCompactValues(values: string[]) {
  if (values.length <= 2) {
    return values.join(' / ');
  }

  return `${values.slice(0, 2).join(' / ')} +${values.length - 2} more`;
}

function getProductStorageValues(product: Product) {
  const values = new Set<string>();

  for (const value of product.variant_attributes?.storage ?? []) {
    if (value.trim()) {
      values.add(value.trim());
    }
  }

  for (const variant of product.variants ?? []) {
    const storage =
      variant.attributes?.storage?.trim() || variant.attributes?.rom?.trim();
    if (storage) {
      values.add(storage);
    }
  }

  return Array.from(values);
}

function getVariantLabel(attributes: Record<string, string> | undefined) {
  if (!attributes) {
    return null;
  }

  const parts = Object.entries(attributes)
    .filter(([key]) => key.trim().toLowerCase() !== 'hex')
    .filter(([, value]) => value)
    .map(([axis, value]) => {
      const label = formatVariantAxisLabel(axis) ?? axis;
      return `${label}: ${value}`;
    });

  return parts.length > 0 ? parts.join(' · ') : null;
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
