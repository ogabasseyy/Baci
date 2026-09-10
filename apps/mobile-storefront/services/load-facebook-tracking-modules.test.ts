import { beforeEach, expect, it, jest } from '@jest/globals';

let mockInitialized = false;
let mockImportError: Error | null = null;
const mockSetAppID = jest.fn();
const mockSetClientToken = jest.fn();
const mockInitializeSDK = jest.fn(async () => {
  mockInitialized = true;
  return true;
});
// Regression target: Android builds must await native initializeSDK completion.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('react-native-fbsdk-next/src/FBSettings', () => ({
  __esModule: true,
  default: {
    setAppID: mockSetAppID,
    setClientToken: mockSetClientToken,
    initializeSDK: mockInitializeSDK,
    // Present on Android but must not be used as an init completion signal.
    getAdvertiserTrackingEnabled: jest.fn(async () => true),
  },
}));
jest.mock('react-native-fbsdk-next/src/FBAppEventsLogger', () => {
  if (mockImportError) throw mockImportError;
  if (!mockInitialized) throw new Error('SDK has not been initialized');
  return { __esModule: true, default: { logEvent: jest.fn() } };
});
jest.mock('react-native-fbsdk-next/src/FBAEMReporter', () => ({
  __esModule: true,
  default: {},
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockInitialized = false;
  mockImportError = null;
  mockInitializeSDK.mockImplementation(async () => {
    mockInitialized = true;
    return true;
  });
});

it('initializes Facebook before importing the native event logger', async () => {
  const { loadFacebookTrackingModules } = await import(
    './load-facebook-tracking-modules'
  );

  const modules = await loadFacebookTrackingModules('app-id', 'client-token');

  expect(mockSetAppID).toHaveBeenCalledWith('app-id');
  expect(mockSetClientToken).toHaveBeenCalledWith('client-token');
  expect(mockInitializeSDK).toHaveBeenCalled();
  expect(modules.events.logEvent).toBeDefined();
  expect(modules.settings).toBeDefined();
  expect(modules.aem).toBeDefined();
});

it('bugfix: awaits Promise initializeSDK before loading dependents on Android', async () => {
  let resolveInit: ((value: boolean) => void) | undefined;
  mockInitializeSDK.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        resolveInit = (value) => {
          mockInitialized = true;
          resolve(value);
        };
      })
  );
  const { loadFacebookTrackingModules } = await import(
    './load-facebook-tracking-modules'
  );

  let settled = false;
  const loading = loadFacebookTrackingModules('app-id', 'client-token').then(
    (modules) => {
      settled = true;
      return modules;
    }
  );

  for (let i = 0; i < 20 && resolveInit === undefined; i += 1) {
    await Promise.resolve();
  }
  expect(resolveInit).toBeDefined();
  expect(settled).toBe(false);
  expect(mockInitialized).toBe(false);

  resolveInit?.(true);
  await loading;
  expect(settled).toBe(true);
  expect(mockInitialized).toBe(true);
  expect(mockInitializeSDK).toHaveBeenCalledTimes(1);
});

it('rejects when a dependent native module cannot load', async () => {
  const error = new Error('Native event logger unavailable');
  mockImportError = error;
  const { loadFacebookTrackingModules } = await import(
    './load-facebook-tracking-modules'
  );

  await expect(
    loadFacebookTrackingModules('app-id', 'client-token')
  ).rejects.toBe(error);
});
