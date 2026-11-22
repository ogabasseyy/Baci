import { act, renderHook } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { useOxygenAccountConfirmation } from './use-oxygen-account-confirmation';

const fields = { bank_code: '058', account_number: '0123456789' };
it('discards confirmation and late results when the account changes', async () => {
  let finish: (value: { accountName: string }) => void = () => {};
  const bankDetails = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ accountName: 'CURRENT' });
  const props = {
    client: { bankDetails } as unknown as OxygenClient,
    workflowId: 'one',
    scopeKey: 'owner',
    fields,
    step: 2 as const,
    loaded: true,
    active: true,
  };
  const { result, rerender } = renderHook(useOxygenAccountConfirmation, {
    initialProps: props,
  });
  rerender({ ...props, fields: { ...fields, account_number: '9876543210' } });
  await act(async () => {});
  await act(async () => finish({ accountName: 'OLD' }));
  expect(result.current.accountName).toBe('CURRENT');
  expect(result.current.checking).toBe(false);
});
it('keeps an in-session confirmation across step changes without another lookup', async () => {
  const bankDetails = jest.fn().mockResolvedValue({ accountName: 'TEST' });
  const props = {
    client: { bankDetails } as unknown as OxygenClient,
    workflowId: 'one',
    scopeKey: 'owner',
    fields,
    step: 1 as 0 | 1 | 2,
    loaded: true,
    active: true,
  };
  const { result, rerender } = renderHook(useOxygenAccountConfirmation, {
    initialProps: props,
  });
  act(() => result.current.confirm('TEST'));
  rerender({ ...props, step: 2 });
  await act(async () => {});
  expect(result.current.accountName).toBe('TEST');
  expect(bankDetails).not.toHaveBeenCalled();
});
it('shows a recoverable bank-specific error when the restored lookup fails', async () => {
  const bankDetails = jest.fn().mockRejectedValue(new Error('Unavailable'));
  const client = { bankDetails } as unknown as OxygenClient;
  const { result } = renderHook(() =>
    useOxygenAccountConfirmation({
      client,
      workflowId: 'one',
      scopeKey: 'owner',
      fields,
      step: 2,
      loaded: true,
      active: true,
    })
  );
  await act(async () => {});
  expect(result.current.checking).toBe(false);
  expect(result.current.accountName).toBe('');
  expect(result.current.error).toMatch(/Bank step/);
  expect(bankDetails).toHaveBeenCalledTimes(1);
});
