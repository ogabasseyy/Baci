import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, renderHook } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';
import { useOxygenHostedStep } from './use-oxygen-hosted-step';

jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

const snapshot = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '11111111-1111-4111-8111-111111111111',
  stage: 'kyc_required',
  version: 2,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    validated: true,
    applicationReference: '22222222-2222-4222-8222-222222222222',
    selfieUrl: 'https://selfie.example/verify',
  },
});
function setup(confirmed: boolean) {
  const selfieStatus = jest.fn().mockResolvedValue({ confirmed });
  const execute = jest.fn().mockResolvedValue(undefined);
  const refresh = jest.fn().mockResolvedValue(undefined);
  return {
    selfieStatus,
    execute,
    refresh,
    options: {
      snapshot,
      ready: true,
      disabled: false,
      client: { selfieStatus } as unknown as OxygenClient,
      controller: { execute, refresh } as unknown as OxygenWorkflowController,
    },
  };
}
it('handles a navigator Back action by closing only the selfie surface', () => {
  const { options, execute, refresh } = setup(false);
  const { result } = renderHook(() => useOxygenHostedStep(options));
  expect(result.current.hosted).toBe('selfie');
  const guard = jest.mocked(usePreventRemove).mock.lastCall;
  expect(guard?.[0]).toBe(true);
  const back = guard?.[1];
  if (!back) throw new Error('Selfie back guard missing');
  act(() => back({ data: { action: { type: 'GO_BACK' } }, repeat: jest.fn() }));
  expect(result.current.hosted).toBeNull();
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(false);
  expect(execute).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('automatically opens the selfie and closes only on canonical KYC confirmation', async () => {
  const { options, selfieStatus, execute } = setup(true);
  const { result, rerender } = renderHook(
    (props: Parameters<typeof useOxygenHostedStep>[0]) =>
      useOxygenHostedStep(props),
    { initialProps: options }
  );
  expect(result.current.hosted).toBe('selfie');
  await act(async () => result.current.refresh());
  expect(selfieStatus).toHaveBeenCalledWith(snapshot.workflowId);
  expect(execute).toHaveBeenCalledWith({ action: 'refresh_kyc' });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result.current.hosted).toBe('selfie');
  rerender({
    ...options,
    snapshot: {
      ...snapshot,
      state: {
        ...snapshot.state,
        kyc: {
          selfie_status: 'DONE',
          bvn_status: 'DONE',
          phone_status: 'DONE',
          address_status: 'NOT_DONE',
          nin_status: 'NOT_DONE',
          bank_status: 'NOT_DONE',
        },
      },
    },
  });
  expect(result.current.hosted).toBeNull();
});
it('does not advance KYC for an unconfirmed selfie, and does not reopen after Back', async () => {
  const { options, execute, refresh } = setup(false);
  const { result, rerender } = renderHook(
    (props: Parameters<typeof useOxygenHostedStep>[0]) =>
      useOxygenHostedStep(props),
    { initialProps: options }
  );
  await act(async () => result.current.refresh());
  expect(execute).not.toHaveBeenCalled();
  act(() => result.current.close());
  rerender({ ...options });
  expect(result.current.hosted).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('preserves the OTP success hold before opening an existing selfie link', () => {
  const { options, execute } = setup(false);
  const { result, rerender } = renderHook(
    (props: Parameters<typeof useOxygenHostedStep>[0]) =>
      useOxygenHostedStep(props),
    { initialProps: { ...options, disabled: true } }
  );
  expect(result.current.hosted).toBeNull();
  rerender(options);
  expect(result.current.hosted).toBe('selfie');
  expect(execute).not.toHaveBeenCalled();
});

it('records confirmed and pending status distinctly without logging provider payloads', async () => {
  jest.mocked(recordOxygenSelfieDiagnostic).mockClear();
  const { options, selfieStatus } = setup(false);
  const { result } = renderHook(() => useOxygenHostedStep(options));
  await act(async () => result.current.refresh());
  await act(async () => result.current.refresh());
  expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledTimes(1);
  expect(recordOxygenSelfieDiagnostic).toHaveBeenLastCalledWith('pending');
  selfieStatus.mockResolvedValue({ confirmed: true });
  await act(async () => result.current.refresh());
  expect(recordOxygenSelfieDiagnostic).toHaveBeenLastCalledWith('confirmed');
});
it('records a status-read failure without claiming selfie rejection', async () => {
  jest.mocked(recordOxygenSelfieDiagnostic).mockClear();
  const { options, selfieStatus, execute } = setup(false);
  selfieStatus.mockRejectedValue(new Error('sensitive provider body'));
  const { result } = renderHook(() => useOxygenHostedStep(options));
  await act(async () => {
    await expect(result.current.refresh()).rejects.toThrow();
  });
  expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledWith(
    'status_unavailable'
  );
  expect(execute).not.toHaveBeenCalled();
});
