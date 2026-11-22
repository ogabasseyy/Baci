import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { act, renderHook } from '@testing-library/react-native';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { useOxygenInitialNin } from './use-oxygen-initial-nin';

const snapshot = {
  workflowId: 'same',
  stage: 'kyc_required',
  executionEnabled: true,
  ninAttemptStatus: 'first_attempt',
  state: {
    validated: true,
    eligible: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
    },
  },
} as OxygenRuntimeSnapshot;
function setup() {
  const execute = jest.fn().mockResolvedValue(undefined);
  return {
    execute,
    controller: {
      execute,
      getState: () => ({ error: null }),
    } as unknown as OxygenWorkflowController,
  };
}
it('automatically submits only the first NIN check once for the verified application', async () => {
  const s = setup();
  const { rerender } = renderHook(
    (p: typeof snapshot) => useOxygenInitialNin(p, s.controller, false),
    { initialProps: snapshot }
  );
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledWith({ action: 'validate_nin' });
  expect(s.execute).toHaveBeenCalledTimes(1);
  rerender({ ...snapshot, version: 10 });
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledTimes(1);
});
it.each([
  'unavailable',
  'safe_retry',
  'blocked',
] as const)('does not automatically submit or retry NIN when admission is %s', async (status) => {
  const s = setup();
  renderHook(() =>
    useOxygenInitialNin(
      { ...snapshot, ninAttemptStatus: status },
      s.controller,
      false
    )
  );
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});
it('does not bypass a busy workflow', async () => {
  const s = setup();
  renderHook(() => useOxygenInitialNin(snapshot, s.controller, true));
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});

it('refreshes canonical KYC after a successful first NIN response so the flow advances', async () => {
  const execute = jest.fn().mockResolvedValue(undefined);
  const controller = {
    execute,
    getState: () => ({ error: null, snapshot }),
  } as unknown as OxygenWorkflowController;
  renderHook(() => useOxygenInitialNin(snapshot, controller, false));
  await act(async () => {});
  expect(execute.mock.calls.map((c) => c[0].action)).toEqual([
    'validate_nin',
    'refresh_kyc',
  ]);
});
