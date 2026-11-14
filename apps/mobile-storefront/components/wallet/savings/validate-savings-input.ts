import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { TERMS_REQUIRED_MESSAGE } from './savings-terms-acceptance';
import { formatDateInput } from './start-savings.helpers';
import type { SavingsProductChoice } from './start-savings.types';
import {
  contributionAboveTargetMessage,
  HEAD_START_ABOVE_TARGET_MESSAGE,
} from './start-savings-controller.utils';

type SavingsInputValidation =
  | {
      formattedStartDate: string;
      ok: true;
      selectedProduct: SavingsProductChoice;
    }
  | { error: string; ok: false };

export function validateSavingsInput(
  input: UseStartSavingsSubmitInput
): SavingsInputValidation {
  if (!input.selectedProduct) {
    return { error: 'Select a product to save for.', ok: false };
  }

  if (
    input.selectedProduct.requiresVariantSelection !== false ||
    (input.selectedProduct.variantId !== null &&
      (typeof input.selectedProduct.variantId !== 'string' ||
        !input.selectedProduct.variantId.trim()))
  ) {
    return {
      error: 'Select the exact device variant you want to save for.',
      ok: false,
    };
  }

  // Defensive: a non-number amount must never pass as valid.
  if (
    !Number.isFinite(input.contributionValue) ||
    input.contributionValue <= 0 ||
    !Number.isFinite(input.targetValue) ||
    input.targetValue <= 0 ||
    !Number.isFinite(input.effectiveInitialContribution) ||
    input.effectiveInitialContribution < 0
  ) {
    return { error: 'Enter a valid savings amount.', ok: false };
  }

  const contributionRefusal = contributionAboveTargetMessage(
    input.contributionValue,
    input.targetValue
  );
  if (contributionRefusal) {
    return { error: contributionRefusal, ok: false };
  }

  // The head start moves at creation on the old wallet: never above target.
  if (
    input.sourceMode === 'manual' &&
    input.targetValue > 0 &&
    input.effectiveInitialContribution > input.targetValue
  ) {
    return { error: HEAD_START_ABOVE_TARGET_MESSAGE, ok: false };
  }

  // The form gates these before review; submit checks them again so a
  // direct submit can never skip the terms or the interest answer.
  // Only an explicit yes counts: a missing answer is not acceptance.
  if (input.acceptsNonWithdrawableTerms !== true) {
    return {
      error: TERMS_REQUIRED_MESSAGE,
      ok: false,
    };
  }
  // undefined = not asked (legacy). A plan that starts PiggyVest setup must
  // carry an explicit answer, so a missing one is never read as "not asked".
  if (
    input.interestChoice === null ||
    (input.startGoalWalletSetup && typeof input.interestChoice !== 'boolean')
  ) {
    return { error: 'Choose whether your plan earns interest.', ok: false };
  }

  if (input.sourceMode === 'auto_debit' && !input.selectedPaymentMethodId) {
    return { error: 'Select a saved card for auto debit.', ok: false };
  }

  const formattedStartDate = formatDateInput(input.startDate);
  if (!formattedStartDate) {
    return { error: 'Select a valid start date.', ok: false };
  }

  return {
    formattedStartDate,
    ok: true,
    selectedProduct: input.selectedProduct,
  };
}
