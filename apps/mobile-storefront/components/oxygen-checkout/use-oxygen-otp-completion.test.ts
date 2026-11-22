import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, renderHook } from '@testing-library/react-native';
import { useOxygenOtpCompletion } from './use-oxygen-otp-completion';

const base = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '11111111-1111-4111-8111-111111111111',
  stage: 'kyc_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  state: {
    applicationReference: '22222222-2222-4222-8222-222222222222',
    validated: false,
  },
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('shows success only on confirmed phone progression, then releases the next screen', () => {
  const { result, rerender } = renderHook(useOxygenOtpCompletion, {
    initialProps: base,
  });
  expect(result.current).toBeNull();
  rerender({ ...base, state: { ...base.state, validated: true } });
  expect(result.current?.kind).toBe('phone');
  act(() => jest.advanceTimersByTime(850));
  expect(result.current).toBeNull();
});
it('does not replay success when resuming an already verified application or another owner', () => {
  const confirmed = { ...base, state: { ...base.state, validated: true } };
  const { result, rerender } = renderHook(useOxygenOtpCompletion, {
    initialProps: confirmed,
  });
  expect(result.current).toBeNull();
  rerender({
    ...confirmed,
    workflowId: '33333333-3333-4333-8333-333333333333',
  });
  expect(result.current).toBeNull();
});
it('holds approval success before opening payment', () => {
  const { result, rerender } = renderHook(useOxygenOtpCompletion, {
    initialProps: { ...base, stage: 'approval_required' as const },
  });
  rerender({ ...base, stage: 'payment_required' });
  expect(result.current?.kind).toBe('approval');
});
