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
});
