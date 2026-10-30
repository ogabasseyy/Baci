import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useLoginScreenController } from './useLoginScreenController';

type LoginResult = { success: boolean; error?: string };
const mockAuthState = {
  isInitialized: false,
  isLoading: false,
  user: null,
  signInWithOtp: jest.fn<(email: string) => Promise<LoginResult>>(),
  verifyOtp: jest.fn<(email: string, token: string) => Promise<LoginResult>>(),
  signInWithPassword:
    jest.fn<(email: string, password: string) => Promise<LoginResult>>(),
  signInWithGoogle: jest.fn<() => Promise<LoginResult>>(),
  signInWithApple: jest.fn<() => Promise<LoginResult>>(),
};

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ email: 'shopper@example.com' }),
  router: { setParams: jest.fn(), back: jest.fn() },
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://example.invalid' }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    withKeyboardDismiss: <Handler>(handler: Handler) => handler,
  }),
}));
jest.mock('./login-resume-state', () => ({
  getAuthLoginResumeState: jest
    .fn<() => Promise<null>>()
    .mockResolvedValue(null),
  saveAuthLoginResumeState: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));
jest.mock('./useLoginHardwareBackHandler', () => ({
  useLoginHardwareBackHandler: () => undefined,
}));

const networkFailure =
  'fetch failed: UnexpectedException: ExpoModulesCore/Promise.swift:56 https://example.invalid?token=synthetic-secret';
const retryMessage =
  "We couldn't connect. Check your internet connection and try again.";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it.each([
  'handleContinue',
  'handleResendOtp',
] as const)('shows safe retry guidance for a native fetch failure in %s', async (action) => {
  mockAuthState.signInWithOtp.mockResolvedValue({
    success: false,
    error: networkFailure,
  });
  const { result } = renderHook(useLoginScreenController);

  await act(async () => {
    await result.current[action]();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Error', retryMessage);
});

it('shows safe retry guidance when password sign-in has a native fetch failure', async () => {
  mockAuthState.signInWithPassword.mockResolvedValue({
    success: false,
    error: networkFailure,
  });
  const { result } = renderHook(useLoginScreenController);
  act(() => result.current.setPassword('synthetic-password'));

  await act(async () => {
    await result.current.handlePasswordSignIn();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Error', retryMessage);
});

it.each([
  [networkFailure, retryMessage],
  ['Invalid code', 'Invalid code'],
  [
    'Email link is invalid or has expired',
    'This code has expired. Request a new code and try again.',
  ],
  [
    'Internal error: token=synthetic-secret',
    "We couldn't sign you in. Please try again.",
  ],
])('safely presents OTP verification failure %s at the caller boundary', async (error, expected) => {
  mockAuthState.verifyOtp.mockResolvedValue({ success: false, error });
  const { result } = renderHook(useLoginScreenController);

  await expect(
    result.current.verifyOtp('shopper@example.com', '123456')
  ).resolves.toEqual({ success: false, error: expected });
});

it('keeps invalid credentials actionable without exposing provider internals', async () => {
  mockAuthState.signInWithPassword.mockResolvedValue({
    success: false,
    error: 'Invalid login credentials',
  });
  const { result } = renderHook(useLoginScreenController);
  act(() => result.current.setPassword('synthetic-password'));

  await act(async () => {
    await result.current.handlePasswordSignIn();
  });

  expect(Alert.alert).toHaveBeenCalledWith(
    'Error',
    'Invalid email or password. Check your details and try again.'
  );
});

it('converts a rejected native verification request into safe retry guidance', async () => {
  mockAuthState.verifyOtp.mockRejectedValue(new Error(networkFailure));
  const { result } = renderHook(useLoginScreenController);

  await expect(
    result.current.verifyOtp('shopper@example.com', '123456')
  ).resolves.toEqual({ success: false, error: retryMessage });
});
