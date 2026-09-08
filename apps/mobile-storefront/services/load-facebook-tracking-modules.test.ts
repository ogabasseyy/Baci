import { beforeEach, expect, it, jest } from '@jest/globals';

let mockInitialized = false;
let mockImportError: Error | null = null;
const mockSetAppID = jest.fn();
const mockSetClientToken = jest.fn();
jest.mock('react-native-fbsdk-next/src/FBSettings', () => ({
  __esModule: true,
  default: {
    setAppID: mockSetAppID,
    setClientToken: mockSetClientToken,
    initializeSDK: () => {
      mockInitialized = true;
    },
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
});

it('initializes Facebook before importing the native event logger', async () => {
  // Arrange
  const { loadFacebookTrackingModules } = await import(
    './load-facebook-tracking-modules'
  );

  // Act
  const modules = await loadFacebookTrackingModules('app-id', 'client-token');

  // Assert
  expect(mockSetAppID).toHaveBeenCalledWith('app-id');
  expect(mockSetClientToken).toHaveBeenCalledWith('client-token');
  expect(modules[1].default.logEvent).toBeDefined();
});

it('rejects when a dependent native module cannot load', async () => {
  const error = new Error('Native event logger unavailable');
  mockImportError = error;
  const { loadFacebookTrackingModules } = await import(
    './load-facebook-tracking-modules'
  );

  const loading = loadFacebookTrackingModules('app-id', 'client-token');

  await expect(loading).rejects.toBe(error);
});
