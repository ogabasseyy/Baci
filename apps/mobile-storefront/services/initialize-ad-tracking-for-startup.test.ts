import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const mockInitAdTracking = jest.fn<() => Promise<void>>();
const mockRecordCrashBreadcrumb = jest.fn();

jest.mock('./ad-tracking', () => ({
  initAdTracking: () => mockInitAdTracking(),
}));

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: (...args: unknown[]) =>
    mockRecordCrashBreadcrumb(...args),
}));

const { initializeAdTrackingForStartup } =
  require('./initialize-ad-tracking-for-startup') as typeof import('./initialize-ad-tracking-for-startup');

describe('initializeAdTrackingForStartup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockInitAdTracking.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('records successful ad tracking initialization', async () => {
    await initializeAdTrackingForStartup();

    expect(mockRecordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_layout:ad_tracking_initialized'
    );
  });

  it('records an error and resolves when initialization rejects', async () => {
    const error = new Error('ATT status failed');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInitAdTracking.mockRejectedValue(error);

    await expect(initializeAdTrackingForStartup()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      'Ad tracking initialization error:',
      error
    );
    expect(mockRecordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_layout:ad_tracking_error',
      { message: 'ATT status failed' }
    );
  });

  it('defers slow initialization without reporting a failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInitAdTracking.mockReturnValue(new Promise(() => {}));

    const initialization = initializeAdTrackingForStartup();
    await jest.runOnlyPendingTimersAsync();

    await expect(initialization).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
    expect(mockRecordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_layout:ad_tracking_deferred'
    );
  });
  it('records eventual success after the startup wait expires', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    let complete!: () => void;
    mockInitAdTracking.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      })
    );

    const initialization = initializeAdTrackingForStartup();
    await jest.advanceTimersByTimeAsync(4000);
    await initialization;
    complete();
    await jest.advanceTimersByTimeAsync(0);

    expect(errorLog).not.toHaveBeenCalled();
    expect(mockRecordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_layout:ad_tracking_initialized'
    );
  });
  it('records eventual failure after the startup wait resolves', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('SDK failed after startup');
    let fail!: (reason: Error) => void;
    mockInitAdTracking.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      })
    );

    const initialization = initializeAdTrackingForStartup();
    await jest.advanceTimersByTimeAsync(4000);
    await expect(initialization).resolves.toBeUndefined();
    fail(error);
    await jest.advanceTimersByTimeAsync(0);

    expect(errorLog).toHaveBeenCalledWith(
      'Ad tracking initialization error:',
      error
    );
    expect(mockRecordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_layout:ad_tracking_error',
      { message: error.message }
    );
  });
});
