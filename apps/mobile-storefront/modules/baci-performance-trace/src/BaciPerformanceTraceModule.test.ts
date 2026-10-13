const mockRequireOptionalNativeModule = jest.fn();

jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mockRequireOptionalNativeModule(name),
}));

describe('BaciPerformanceTraceModule', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRequireOptionalNativeModule.mockReset();
  });

  it('exports the installed optional native module', () => {
    const nativeModule = {
      beginAsyncSection: jest.fn(() => 12),
      endAsyncSection: jest.fn(),
    };
    mockRequireOptionalNativeModule.mockReturnValue(nativeModule);

    const loaded = jest.requireActual('./BaciPerformanceTraceModule').default;

    expect(mockRequireOptionalNativeModule).toHaveBeenCalledWith(
      'BaciPerformanceTrace'
    );
    expect(loaded).toBe(nativeModule);
  });

  it('exports null when the optional native module is unavailable', () => {
    mockRequireOptionalNativeModule.mockReturnValue(null);

    const loaded = jest.requireActual('./BaciPerformanceTraceModule').default;

    expect(loaded).toBeNull();
  });
});
