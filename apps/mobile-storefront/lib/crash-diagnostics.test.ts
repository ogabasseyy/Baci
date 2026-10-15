import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as Sentry from '@sentry/react-native';
import {
  getCrashBreadcrumbsForTest,
  installCrashDiagnostics,
  MAX_BREADCRUMBS,
  recordCrashBreadcrumb,
  resetCrashDiagnosticsForTest,
} from './crash-diagnostics';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type GlobalWithErrorUtils = typeof globalThis & {
  ErrorUtils?: {
    getGlobalHandler?: () => GlobalErrorHandler;
    setGlobalHandler?: (handler: GlobalErrorHandler) => void;
  };
};

const globalWithErrorUtils = globalThis as GlobalWithErrorUtils;

describe('crash diagnostics', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCrashDiagnosticsForTest();
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    delete globalWithErrorUtils.ErrorUtils;
  });

  it('persists safe state breadcrumbs to native Sentry without private details', () => {
    recordCrashBreadcrumb('home:state', {
      blockCount: 4,
      isFocused: false,
      customerEmail: 'private@example.com',
      selectedCategoryId: 'private-id',
      error: 'token=private',
    });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'app.diagnostics',
      message: 'home:state',
      level: 'info',
      data: { blockCount: 4, isFocused: false },
    });
  });

  it('keeps diagnostics and error-handler chaining working when Sentry throws', () => {
    jest.mocked(Sentry.addBreadcrumb).mockImplementationOnce(() => {
      throw new Error('native unavailable');
    });
    expect(() => recordCrashBreadcrumb('home:unmounted')).not.toThrow();
    expect(getCrashBreadcrumbsForTest().at(-1)?.name).toBe('home:unmounted');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('records bounded crash breadcrumbs', () => {
    for (let index = 0; index <= MAX_BREADCRUMBS; index += 1) {
      recordCrashBreadcrumb(`home:state:${index}`, { index });
    }

    const breadcrumbs = getCrashBreadcrumbsForTest();
    expect(breadcrumbs).toHaveLength(MAX_BREADCRUMBS);
    expect(breadcrumbs[0]).toEqual(
      expect.objectContaining({
        details: { index: 1 },
        name: 'home:state:1',
      })
    );
    expect(breadcrumbs.at(-1)).toEqual(
      expect.objectContaining({
        details: { index: MAX_BREADCRUMBS },
        name: `home:state:${MAX_BREADCRUMBS}`,
      })
    );
  });

  it('logs breadcrumbs when the global JS error handler fires', () => {
    const previousHandler = jest.fn();
    let capturedHandler: GlobalErrorHandler | undefined;
    globalWithErrorUtils.ErrorUtils = {
      getGlobalHandler: () => previousHandler,
      setGlobalHandler: (handler) => {
        capturedHandler = handler;
      },
    };

    installCrashDiagnostics('RootLayout');
    recordCrashBreadcrumb('home:ready', { blockCount: 3 });
    capturedHandler?.(new Error('boom'), true);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ERROR]',
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/),
      '[CrashDiagnostics]',
      'global JS error',
      expect.objectContaining({
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({ name: 'home:ready' }),
        ]),
        context: 'RootLayout',
        isFatal: true,
      })
    );
    expect(previousHandler).toHaveBeenCalledWith(expect.any(Error), true);
  });
});
