import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { formatDateInput } from './start-savings.helpers';
import type { SavingsProductChoice } from './start-savings.types';
import { contributionAboveTargetMessage } from './start-savings-controller.utils';

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

  const contributionRefusal = contributionAboveTargetMessage(
    input.contributionValue,
    input.targetValue
  );
  if (contributionRefusal) {
    return { error: contributionRefusal, ok: false };
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
