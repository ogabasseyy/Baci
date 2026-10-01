import * as Sentry from '@sentry/react-native';
import { AppState } from 'react-native';
import { recordCrashBreadcrumb } from './crash-diagnostics';
import { installMemoryWarningDiagnostics } from './memory-warning-diagnostics';

const mockAddEventListener = jest.fn();
const mockRemove = jest.fn();

jest.mock('expo-image', () => ({
  Image: { clearMemoryCache: jest.fn() },
}));

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn() }));

jest.mock('./crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));

describe('memory warning diagnostics', () => {
  const mockedImage = require('expo-image') as {
    Image: { clearMemoryCache: jest.Mock };
  };
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    dispose = undefined;
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'addEventListener', {
      configurable: true,
      value: mockAddEventListener,
    });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    mockAddEventListener.mockReturnValue({ remove: mockRemove });
    mockedImage.Image.clearMemoryCache.mockResolvedValue(true);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('releases decoded images and sends a bounded native breadcrumb', () => {
    dispose = installMemoryWarningDiagnostics();
    installMemoryWarningDiagnostics();

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    const listener = mockAddEventListener.mock.calls[0]?.[1] as () => void;

    listener();

    const details = { app_state: 'active', warning_count: 1 };
    expect(mockedImage.Image.clearMemoryCache).toHaveBeenCalledTimes(1);
    expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
      'app:memory_warning',
      details
    );
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'app.memory',
      data: details,
      level: 'warning',
      message: 'memory_warning',
    });
  });

  it('does not throw when the native image cache cannot be cleared', () => {
    mockedImage.Image.clearMemoryCache.mockImplementation(() => {
      throw new Error('native image module unavailable');
    });
    dispose = installMemoryWarningDiagnostics();
    const listener = mockAddEventListener.mock.calls[0]?.[1] as () => void;

    expect(() => listener()).not.toThrow();
    expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
      'app:memory_warning',
      expect.objectContaining({ warning_count: 1 })
    );
  });

  it('removes the listener when its disposer is called', () => {
    dispose = installMemoryWarningDiagnostics();

    dispose();
    dispose = undefined;

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
