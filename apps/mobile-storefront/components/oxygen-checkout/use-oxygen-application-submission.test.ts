import { act, renderHook } from '@testing-library/react-native';
import { useOxygenApplicationSubmission } from './use-oxygen-application-submission';

const fields = {
  first_name: 'Test',
  last_name: 'Customer',
  email: 'test@example.invalid',
  bvn: '12345678901',
  nin: '12345678901',
  date_of_birth: '1990-01-01',
  bank_code: '058',
  account_number: '0123456789',
  employment_status: 'EMPLOYED',
  salary_amount: '200000',
  salary_date: '29',
};
it('does not submit to Oxygen when the final durable save fails', async () => {
  const onExecute = jest.fn();
  const { result } = renderHook(() =>
    useOxygenApplicationSubmission({
      fields,
      banks: [{ code: '058', name: 'GT Bank' }],
      accountName: 'TEST CUSTOMER',
      checking: false,
      consent: true,
      checkoutPhone: '08012345678',
      setFieldErrors: jest.fn(),
      setError: jest.fn(),
      save: jest.fn().mockResolvedValue(false),
      onExecute,
    })
  );
  await act(async () => result.current.submit());
  expect(onExecute).not.toHaveBeenCalled();
  expect(result.current.label).toBeNull();
});
it('surfaces field-specific employment errors and consentError instead of blocking silently', async () => {
  const setFieldErrors = jest.fn();
  const setConsentError = jest.fn();
  const setError = jest.fn();
  const onExecute = jest.fn();
  const { result, rerender } = renderHook(
    ({
      customFields,
      consent,
    }: {
      customFields: typeof fields & { name_of_employer?: string };
      consent: boolean;
    }) =>
      useOxygenApplicationSubmission({
        fields: customFields,
        banks: [{ code: '058', name: 'GT Bank' }],
        accountName: 'TEST CUSTOMER',
        checking: false,
        consent,
        checkoutPhone: '08012345678',
        setFieldErrors,
        setConsentError,
        setError,
        save: jest.fn().mockResolvedValue(true),
        onExecute,
      }),
    {
      initialProps: {
        customFields: {
          ...fields,
          salary_amount: '',
          name_of_employer: 'x'.repeat(151),
        },
        consent: false,
      },
    }
  );
  await act(async () => result.current.submit());
  expect(setFieldErrors).toHaveBeenLastCalledWith({
    salary_amount: 'Enter your monthly income.',
    name_of_employer: 'Employer name must be 150 characters or fewer.',
  });
  expect(setError).toHaveBeenLastCalledWith(
    'Check the highlighted employment and income details.'
  );
  rerender({ customFields: fields, consent: false });
  await act(async () => result.current.submit());
  expect(setConsentError).toHaveBeenLastCalledWith(
    'Accept Oxygen’s terms to continue.'
  );
  expect(setError).toHaveBeenLastCalledWith(
    'Accept Oxygen’s terms before continuing.'
  );
  expect(onExecute).not.toHaveBeenCalled();
});
it('shows save and code-request phases, fences repeat taps, then unlocks after failure', async () => {
  let finishSave: (saved: boolean) => void = () => {};
  let finishRequest: () => void = () => {};
  const save = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      })
  );
  const onExecute = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finishRequest = resolve;
      })
  );
  const options = {
    fields,
    banks: [{ code: '058', name: 'GT Bank' }],
    accountName: 'TEST CUSTOMER',
    checking: false,
    consent: true,
    checkoutPhone: '08012345678',
    setFieldErrors: jest.fn(),
    setError: jest.fn(),
    save,
    onExecute,
  };
  const { result } = renderHook(() => useOxygenApplicationSubmission(options));
  let request: Promise<void> | undefined;
  act(() => {
    request = result.current.submit();
  });
  expect(result.current.label).toBe('Saving your details…');
  await act(async () => result.current.submit());
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finishSave(true));
  expect(result.current.label).toBe('Requesting your code…');
  expect(onExecute).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishRequest();
    await request;
  });
  expect(result.current.label).toBeNull();
});
