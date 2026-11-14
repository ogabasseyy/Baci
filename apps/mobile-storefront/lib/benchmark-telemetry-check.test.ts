import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/react-native';
import { asyncStorage } from '@/lib/storage';

const mockScope = {
  setUser: jest.fn(),
  clearBreadcrumbs: jest.fn(),
  addEventProcessor: jest.fn(),
};
jest.mock('@sentry/react-native', () => ({
  getClient: jest.fn(),
  withScope: jest.fn((callback: (scope: typeof mockScope) => unknown) =>
    callback(mockScope)
  ),
  captureMessage: jest.fn(),
  flush: jest.fn(),
}));
jest.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const { createBenchmarkTelemetryVerifier } =
  require('./benchmark-telemetry-check') as typeof import('./benchmark-telemetry-check');
function loadCheck(
  diagnosticId: string | undefined = 'synthetic-test-1',
  environment = 'benchmark'
) {
  return createBenchmarkTelemetryVerifier({ diagnosticId, environment });
}
describe('benchmark telemetry receipt diagnostic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(asyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(asyncStorage.setItem).mockResolvedValue(undefined);
    jest.mocked(asyncStorage.removeItem).mockResolvedValue(undefined);
    jest
      .mocked(Sentry.getClient)
      .mockReturnValue({ getOptions: () => ({ enabled: true }) } as never);
    jest.mocked(Sentry.captureMessage).mockReturnValue('a'.repeat(32));
    jest.mocked(Sentry.flush).mockResolvedValue(true);
  });
  it('does nothing without explicit identifier or outside benchmark environment', async () => {
    await createBenchmarkTelemetryVerifier({ environment: 'benchmark' })();
    await loadCheck('synthetic-test-1', 'production')();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('captures once and records an attempt across concurrent calls and restarts', async () => {
    const verify = loadCheck();
    await Promise.all([verify(), verify()]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Startup telemetry verification',
      expect.objectContaining({
        level: 'info',
        tags: {
          diagnostic_id: 'synthetic-test-1',
          verification_kind: 'startup_receipt',
        },
      })
    );
    expect(mockScope.setUser).toHaveBeenCalledWith(null);
    expect(mockScope.clearBreadcrumbs).toHaveBeenCalled();
    expect(asyncStorage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      'synthetic-test-1'
    );
    expect(Sentry.flush).toHaveBeenCalledTimes(1);
    jest.mocked(asyncStorage.getItem).mockResolvedValue('synthetic-test-1');
    await loadCheck()();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
  it('scrubs inherited identity, breadcrumbs and request context before sending', async () => {
    await loadCheck()();
    const processor = mockScope.addEventProcessor.mock.calls[0][0] as (
      value: unknown
    ) => Record<string, unknown>;
    const event = processor({
      user: { email: 'private' },
      breadcrumbs: [{ message: 'private-url' }],
      contexts: { device: { id: 'private' } },
      request: { url: 'private-url' },
      extra: { secret: 'private' },
      tags: { old: 'private' },
    });
    expect(event).toMatchObject({
      environment: 'benchmark',
      breadcrumbs: [],
      tags: {
        diagnostic_id: 'synthetic-test-1',
        verification_kind: 'startup_receipt',
      },
    });
    expect(event.user).toBeUndefined();
    expect(event.contexts).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
  });
  it('keeps the attempt marker when flushing returns false, without claiming receipt', async () => {
    jest.mocked(Sentry.flush).mockResolvedValue(false);
    await expect(loadCheck()()).resolves.toBeUndefined();
    expect(asyncStorage.setItem).toHaveBeenCalled();
    expect(asyncStorage.removeItem).not.toHaveBeenCalled();
  });
  it('does not throw or record an attempt when the SDK is unavailable', async () => {
    jest.mocked(Sentry.getClient).mockReturnValue(undefined);
    await expect(loadCheck()()).resolves.toBeUndefined();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('does not send when the client is disabled', async () => {
    jest
      .mocked(Sentry.getClient)
      .mockReturnValue({ getOptions: () => ({ enabled: false }) } as never);
    await loadCheck()();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('removes the marker when capture returns no event id', async () => {
    jest.mocked(Sentry.captureMessage).mockReturnValue('');
    await loadCheck()();
    expect(asyncStorage.removeItem).toHaveBeenCalled();
  });
  it('does not retain an attempted marker when capture throws or yields no event id', async () => {
    jest.mocked(Sentry.captureMessage).mockImplementation(() => {
      throw new Error('synthetic failure');
    });
    await expect(loadCheck()()).resolves.toBeUndefined();
    expect(asyncStorage.removeItem).toHaveBeenCalled();
  });
});
