import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, renderHook } from '@testing-library/react-native';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { useOxygenEligibilityProgress } from './use-oxygen-eligibility-progress';

const snapshot = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '11111111-1111-4111-8111-111111111111',
  version: 4,
  stage: 'eligibility_required',
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    validated: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
      bank_status: 'NOT_DONE',
      address_status: 'NOT_DONE',
    },
  },
});
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
it('starts eligibility once after canonical selfie confirmation without waiting for NIN or bank', async () => {
  const s = setup();
  const { rerender } = renderHook(
    (p: { snapshot: typeof snapshot; blocked: boolean }) =>
      useOxygenEligibilityProgress(p.snapshot, s.controller, p.blocked),
    { initialProps: { snapshot, blocked: false } }
  );
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  rerender({ snapshot: { ...snapshot, version: 5 }, blocked: false });
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledTimes(1);
});
it('retries a failed initial check when saved progress is refreshed', async () => {
  let error: Error | null = null;
  const execute = jest
    .fn()
    .mockImplementationOnce(async () => {
      error = new Error('Connection lost');
    })
    .mockResolvedValue(undefined);
  const controller = {
    execute,
    getState: () => ({ error }),
  } as unknown as OxygenWorkflowController;
  const { rerender } = renderHook(
    (p: { snapshot: typeof snapshot; blocked: boolean }) =>
      useOxygenEligibilityProgress(p.snapshot, controller, p.blocked),
    { initialProps: { snapshot, blocked: false } }
  );
  await act(async () => {});
  rerender({ snapshot, blocked: true });
  await act(async () => {});
  expect(execute).toHaveBeenCalledTimes(1);
  error = null;
  rerender({ snapshot: { ...snapshot }, blocked: false });
  await act(async () => {});
  expect(execute).toHaveBeenCalledTimes(2);
});

it('never retries a failure automatically or advances without selfie confirmation', async () => {
  const s = setup();
  const { rerender } = renderHook(
    (p: typeof snapshot) =>
      useOxygenEligibilityProgress(p, s.controller, false),
    {
      initialProps: {
        ...snapshot,
        state: {
          ...snapshot.state,
          kyc: {
            phone_status: 'DONE',
            bvn_status: 'DONE',
            selfie_status: 'NOT_DONE',
            nin_status: 'NOT_DONE',
            bank_status: 'NOT_DONE',
            address_status: 'NOT_DONE',
          },
        },
      },
    }
  );
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
  rerender({
    ...snapshot,
    state: { ...snapshot.state, eligibilityStatus: 'failed' as const },
  });
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});
it('waits for a busy or uncertain workflow and keeps all financial actions untouched', async () => {
  const s = setup();
  renderHook(() => useOxygenEligibilityProgress(snapshot, s.controller, true));
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});

it('does not recheck a saved pending application automatically on every revisit', async () => {
  const s = setup();
  const pending = {
    ...snapshot,
    state: { ...snapshot.state, eligibilityStatus: 'pending' as const },
  };
  const { result } = renderHook(() =>
    useOxygenEligibilityProgress(pending, s.controller, false)
  );
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
  expect(result.current.delayed).toBe(true);
});

it('follows up an explicitly pending result automatically with bounded status checks', async () => {
  jest.useFakeTimers();
  try {
    const s = setup();
    const { rerender, result } = renderHook(
      (p: typeof snapshot) =>
        useOxygenEligibilityProgress(p, s.controller, false),
      { initialProps: snapshot }
    );
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(s.execute).toHaveBeenCalledTimes(1);
    const pending = {
      ...snapshot,
      version: 5,
      state: { ...snapshot.state, eligibilityStatus: 'pending' as const },
    };
    rerender(pending);
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(s.execute).toHaveBeenCalledTimes(2);
    rerender({ ...pending, version: 6 });
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(s.execute).toHaveBeenCalledTimes(3);
    rerender({ ...pending, version: 7 });
    await act(async () => {
      jest.advanceTimersByTime(40000);
    });
    expect(s.execute).toHaveBeenCalledTimes(3);
    expect(result.current.delayed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
