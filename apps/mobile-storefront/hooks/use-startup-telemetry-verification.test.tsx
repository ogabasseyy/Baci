import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useStartupTelemetryVerification } from './use-startup-telemetry-verification';

const mockShouldVerify = jest
  .fn<(readiness: Record<string, boolean>) => boolean>()
  .mockReturnValue(false);
const mockVerifyBenchmarkTelemetry = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.mock('@/lib/startup-telemetry-eligibility', () => ({
  shouldVerifyStartupTelemetry: (readiness: Record<string, boolean>) =>
    mockShouldVerify(readiness),
}));
jest.mock('@/lib/verify-benchmark-telemetry', () => ({
  verifyBenchmarkTelemetry: () => mockVerifyBenchmarkTelemetry(),
}));

it('runs the telemetry verifier only when startup readiness qualifies', () => {
  const readiness = {
    appInitialized: true,
    loaded: true,
    nativeIntroSettled: true,
    showSplash: false,
    storageReady: true,
    timedOut: false,
  };
  const { rerender } = renderHook(
    (props: typeof readiness) => useStartupTelemetryVerification(props),
    { initialProps: readiness }
  );
  expect(mockShouldVerify).toHaveBeenCalledWith(readiness);
  expect(mockVerifyBenchmarkTelemetry).not.toHaveBeenCalled();

  mockShouldVerify.mockReturnValue(true);
  rerender({ ...readiness, loaded: false });
  expect(mockVerifyBenchmarkTelemetry).toHaveBeenCalledTimes(1);
});
