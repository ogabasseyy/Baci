import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());
it('records only a static event name without sensitive provider data', () => {
  recordOxygenSelfieDiagnostic('confirmed');
  expect(recordCrashBreadcrumb).toHaveBeenCalledWith('oxygen:selfie:confirmed');
  // Runtime protection also rejects untyped bridge/network inputs.
  recordOxygenSelfieDiagnostic(
    'https://provider.example?token=secret' as 'confirmed'
  );
  expect(recordCrashBreadcrumb).toHaveBeenCalledTimes(1);
});
it('does not let diagnostic failures interrupt verification', () => {
  jest.mocked(recordCrashBreadcrumb).mockImplementationOnce(() => {
    throw new Error();
  });
  expect(() => recordOxygenSelfieDiagnostic('pending')).not.toThrow();
});
