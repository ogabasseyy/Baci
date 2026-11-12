import { createInput } from './use-start-savings-submit.test-utils';
import { validateSavingsInput } from './validate-savings-input';

// Validation is local form logic: it asks no server and gives the same
// answers whatever the server's PiggyVest state.
describe('server keeps PiggyVest off', () => {
  it('accepts a complete manual goal without any network call', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const result = validateSavingsInput(createInput() as never);
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps the legacy form errors', () => {
    expect(
      validateSavingsInput(createInput({ selectedProduct: null }) as never)
    ).toEqual({ error: 'Select a product to save for.', ok: false });
    expect(
      validateSavingsInput(createInput({ sourceMode: 'auto_debit' }) as never)
    ).toEqual({ error: 'Select a saved card for auto debit.', ok: false });
  });

  it('refuses a head start or a saving above the target', () => {
    expect(
      validateSavingsInput(
        createInput({
          effectiveInitialContribution: 900_000,
          targetValue: 800_000,
        }) as never
      )
    ).toEqual({
      error: 'Your head start cannot be more than the plan target.',
      ok: false,
    });
    expect(
      validateSavingsInput(
        createInput({
          contributionValue: 900_000,
          targetValue: 800_000,
        }) as never
      )
    ).toEqual({
      error:
        'Each saving can’t be more than the phone’s price. Try a smaller amount.',
      ok: false,
    });
  });

  describe('bugfix: a direct submit could skip the terms or the interest answer', () => {
    it('refuses without the accepted terms', () => {
      expect(
        validateSavingsInput(
          createInput({ acceptsNonWithdrawableTerms: false }) as never
        )
      ).toEqual({
        error: 'You must accept the non-withdrawable savings terms.',
        ok: false,
      });
    });

    it('refuses a PiggyVest plan without an interest answer', () => {
      expect(
        validateSavingsInput(createInput({ interestChoice: null }) as never)
      ).toEqual({
        error: 'Choose whether your plan earns interest.',
        ok: false,
      });
    });

    it('accepts when interest is not asked (legacy wallet)', () => {
      expect(
        validateSavingsInput(
          createInput({ interestChoice: undefined }) as never
        ).ok
      ).toBe(true);
    });
  });

  it('refuses an amount that is not a real number', () => {
    expect(
      validateSavingsInput(
        createInput({ contributionValue: Number.NaN }) as never
      )
    ).toEqual({ error: 'Enter a valid savings amount.', ok: false });
    expect(
      validateSavingsInput(createInput({ targetValue: Number.NaN }) as never)
    ).toEqual({ error: 'Enter a valid savings amount.', ok: false });
  });
});
