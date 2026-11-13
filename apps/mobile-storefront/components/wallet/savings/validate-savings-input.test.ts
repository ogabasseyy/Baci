import { describe, expect, it } from '@jest/globals';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { createInput } from './use-start-savings-submit.test-utils';
import { validateSavingsInput } from './validate-savings-input';

const validate = (overrides = {}) =>
  validateSavingsInput(
    createInput(overrides) as unknown as UseStartSavingsSubmitInput
  );

describe('validateSavingsInput', () => {
  it('bugfix: a missing terms answer is not acceptance', () => {
    expect(validate({ acceptsNonWithdrawableTerms: undefined })).toEqual({
      error:
        'Tick the box to agree that this money stays saved until your goal is done.',
      ok: false,
    });
  });

  it('bugfix: a PiggyVest plan with no interest answer at all is refused', () => {
    expect(
      validate({
        interestChoice: undefined,
        startGoalWalletSetup: async () => undefined,
      })
    ).toEqual({
      error: 'Choose whether your plan earns interest.',
      ok: false,
    });
    expect(validate({ interestChoice: undefined }).ok).toBe(true);
  });

  it('bugfix: refuses a negative head start instead of sending it on', () => {
    expect(validate({ effectiveInitialContribution: -5000 })).toEqual({
      error: 'Enter a valid savings amount.',
      ok: false,
    });
  });

  it('accepts a complete input and formats the start date', () => {
    const result = validate();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.formattedStartDate).toBe('2026-05-22');
  });

  it('requires a product', () => {
    expect(validate({ selectedProduct: null })).toEqual({
      error: 'Select a product to save for.',
      ok: false,
    });
  });

  it('requires an exact variant when selection is pending or the id is blank', () => {
    const base = createInput().selectedProduct;
    const message = 'Select the exact device variant you want to save for.';
    expect(
      validate({ selectedProduct: { ...base, requiresVariantSelection: true } })
    ).toEqual({ error: message, ok: false });
    expect(validate({ selectedProduct: { ...base, variantId: '  ' } })).toEqual(
      { error: message, ok: false }
    );
  });

  it('requires a saved card for auto debit', () => {
    expect(
      validate({ sourceMode: 'auto_debit', selectedPaymentMethodId: null })
    ).toEqual({ error: 'Select a saved card for auto debit.', ok: false });
  });

  it('rejects an invalid start date', () => {
    expect(validate({ startDate: 'not-a-date' })).toEqual({
      error: 'Select a valid start date.',
      ok: false,
    });
  });
});
