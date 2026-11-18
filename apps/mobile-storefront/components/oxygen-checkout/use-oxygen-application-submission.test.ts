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
      hasProof: true,
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
    hasProof: true,
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
