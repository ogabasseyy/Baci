const mockRequireOptionalNativeModule = jest.fn();

jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mockRequireOptionalNativeModule(name),
}));

describe('baci-performance-trace public module', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRequireOptionalNativeModule.mockReset();
  });

  it('re-exports the installed optional native module', () => {
    const nativeModule = {
      beginAsyncSection: jest.fn(() => 12),
      endAsyncSection: jest.fn(),
    };
    mockRequireOptionalNativeModule.mockReturnValue(nativeModule);

    const loaded = (jest.requireActual('./index') as typeof import('./index'))
      .default;

    expect(mockRequireOptionalNativeModule).toHaveBeenCalledWith(
      'BaciPerformanceTrace'
    );
    expect(loaded).toBe(nativeModule);
  });

  it('exports null when the optional native module is unavailable', () => {
    mockRequireOptionalNativeModule.mockReturnValue(null);

    const loaded = (jest.requireActual('./index') as typeof import('./index'))
      .default;

    expect(loaded).toBeNull();
  });
});
