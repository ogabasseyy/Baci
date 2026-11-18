import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { useOxygenSelfieRenewal } from './use-oxygen-selfie-renewal';

jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));
const url = `https://selfie.example/?securityToken=a.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.c`;
function setup(
  confirmed = false,
  replacement = 'https://selfie.example/fresh'
) {
  const selfieStatus = jest.fn().mockResolvedValue({ confirmed });
  const execute = jest.fn().mockResolvedValue(undefined);
  const getState = jest.fn().mockReturnValue({
    error: null,
    snapshot: { state: { selfieUrl: replacement } },
  });
  return {
    selfieStatus,
    execute,
    options: {
      url,
      enabled: true,
      blocked: false,
      workflowId: 'workflow',
      client: { selfieStatus } as unknown as OxygenClient,
      controller: { execute, getState } as unknown as OxygenWorkflowController,
    },
  };
}
beforeEach(() => {
  AppState.currentState = 'active';
});
it('checks completion then automatically renews only the existing selfie link once', async () => {
  const s = setup();
  const { result, rerender } = renderHook(
    (p: Parameters<typeof useOxygenSelfieRenewal>[0]) =>
      useOxygenSelfieRenewal(p),
    {
      initialProps: s.options,
    }
  );
  await act(async () => {});
  expect(s.selfieStatus).toHaveBeenCalledWith('workflow');
  expect(s.execute).toHaveBeenCalledWith({ action: 'selfie_link' });
  rerender({ ...s.options });
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledTimes(1);
  expect(result.current.renewing).toBe(false);
});
it('never renews when Oxygen already confirms the selfie', async () => {
  const s = setup(true);
  renderHook(() => useOxygenSelfieRenewal(s.options));
  await act(async () => {});
  expect(s.execute).toHaveBeenCalledWith({ action: 'refresh_kyc' });
  expect(s.execute).not.toHaveBeenCalledWith({ action: 'selfie_link' });
});
it('does not repeat the expired URL or loop when renewal fails', async () => {
  const s = setup(false, url);
  const { result } = renderHook(() => useOxygenSelfieRenewal(s.options));
  await act(async () => {});
  expect(result.current.error).toBeTruthy();
  expect(s.execute).toHaveBeenCalledTimes(1);
});
it('does not dispatch while backgrounded or another workflow command is pending', async () => {
  AppState.currentState = 'background';
  const s = setup();
  const { rerender } = renderHook(
    (p: Parameters<typeof useOxygenSelfieRenewal>[0]) =>
      useOxygenSelfieRenewal(p),
    {
      initialProps: s.options,
    }
  );
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  rerender({ ...s.options, blocked: true });
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});

it('bounds manual retries and coalesces concurrent renewal taps', async () => {
  const s = setup(false, url);
  const { result } = renderHook(() => useOxygenSelfieRenewal(s.options));
  await act(async () => {});
  await act(async () => {
    await Promise.all([result.current.renew(), result.current.renew()]);
  });
  expect(s.execute).toHaveBeenCalledTimes(2);
  await act(async () => result.current.renew());
  await act(async () => result.current.renew());
  expect(s.execute).toHaveBeenCalledTimes(3);
});
it('never guesses an expiry or renews a still-valid session', async () => {
  const s = setup();
  const { rerender } = renderHook(
    (p: Parameters<typeof useOxygenSelfieRenewal>[0]) =>
      useOxygenSelfieRenewal(p),
    {
      initialProps: { ...s.options, url: 'https://selfie.example/opaque' },
    }
  );
  await act(async () => {});
  const future = `https://selfie.example/?securityToken=a.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.c`;
  rerender({ ...s.options, url: future });
  await act(async () => {});
  expect(s.execute).not.toHaveBeenCalled();
});
it('automatically recovers when an open session expires, without an interval loop', async () => {
  jest.useFakeTimers();
  try {
    const s = setup();
    const future = `https://selfie.example/?securityToken=a.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 2 })).toString('base64url')}.c`;
    renderHook(() => useOxygenSelfieRenewal({ ...s.options, url: future }));
    expect(s.execute).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    expect(s.execute).toHaveBeenCalledWith({ action: 'selfie_link' });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(s.execute).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
it('does not dispatch renewal after the camera was closed during the status read', async () => {
  const s = setup();
  let resolve!: (r: { confirmed: boolean }) => void;
  s.selfieStatus.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { rerender } = renderHook(
    (p: Parameters<typeof useOxygenSelfieRenewal>[0]) =>
      useOxygenSelfieRenewal(p),
    {
      initialProps: s.options,
    }
  );
  rerender({ ...s.options, enabled: false });
  await act(async () => resolve({ confirmed: false }));
  expect(s.execute).not.toHaveBeenCalled();
});

it('does not renew a different application if scope changes during the status read', async () => {
  const s = setup();
  let resolve!: (r: { confirmed: boolean }) => void;
  s.selfieStatus.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { rerender } = renderHook(
    (p: Parameters<typeof useOxygenSelfieRenewal>[0]) =>
      useOxygenSelfieRenewal(p),
    { initialProps: s.options }
  );
  rerender({ ...s.options, workflowId: 'different-workflow' });
  await act(async () => resolve({ confirmed: false }));
  expect(s.execute).not.toHaveBeenCalled();
});
