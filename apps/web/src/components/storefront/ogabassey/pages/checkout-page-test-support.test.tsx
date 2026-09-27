import { expect, it, usePersistedForm, vi } from './checkout-page-test-support';

it('allows a scenario to configure a persisted payment step', () => {
  const initial = usePersistedForm('checkout-form', { currentStep: 'contact' });
  vi.mocked(usePersistedForm).mockReturnValue({
    ...initial,
    values: { ...initial.values, currentStep: 'payment' },
  });
  expect(
    usePersistedForm('checkout-form', { currentStep: 'contact' }).values
      .currentStep
  ).toBe('payment');
});
it('starts the next scenario with the default contact step', () => {
  expect(
    usePersistedForm('checkout-form', { currentStep: 'contact' }).values
      .currentStep
  ).toBe('contact');
});
