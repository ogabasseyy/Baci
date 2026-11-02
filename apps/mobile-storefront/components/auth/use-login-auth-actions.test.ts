import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useLoginAuthActions } from './use-login-auth-actions';

type LoginResult = { success: boolean; error?: string };
const mockActions = {
  signInWithOtp: jest.fn<(email: string) => Promise<LoginResult>>(),
  signInWithPassword:
    jest.fn<(email: string, password: string) => Promise<LoginResult>>(),
  verifyOtp: jest.fn<(email: string, token: string) => Promise<LoginResult>>(),
};

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof mockActions) => unknown) =>
    selector(mockActions),
}));

it('preserves successful credential results and forwards the supplied inputs', async () => {
  mockActions.signInWithOtp.mockResolvedValue({ success: true });
  mockActions.signInWithPassword.mockResolvedValue({ success: true });
  mockActions.verifyOtp.mockResolvedValue({ success: true });
  const { result } = renderHook(useLoginAuthActions);

  await expect(
    result.current.signInWithOtp('shopper@example.com')
  ).resolves.toEqual({ success: true });
  await expect(
    result.current.signInWithPassword(
      'shopper@example.com',
      'synthetic-password'
    )
  ).resolves.toEqual({ success: true });
  await expect(
    result.current.verifyOtp('shopper@example.com', '123456')
  ).resolves.toEqual({ success: true });
  expect(mockActions.signInWithOtp).toHaveBeenCalledWith('shopper@example.com');
  expect(mockActions.signInWithPassword).toHaveBeenCalledWith(
    'shopper@example.com',
    'synthetic-password'
  );
  expect(mockActions.verifyOtp).toHaveBeenCalledWith(
    'shopper@example.com',
    '123456'
  );
});

it.each([
  [
    'Network request failed',
    "We couldn't connect. Check your internet connection and try again.",
  ],
  [
    'Request timed out',
    "We couldn't connect. Check your internet connection and try again.",
  ],
  ['otp_expired', 'This code has expired. Request a new code and try again.'],
  [
    'invalid_credentials',
    'Invalid email or password. Check your details and try again.',
  ],
  [undefined, "We couldn't sign you in. Please try again."],
])('presents safe guidance for %s', async (error, expected) => {
  mockActions.signInWithOtp.mockResolvedValue({ success: false, error });
  const { result } = renderHook(useLoginAuthActions);

  await expect(
    result.current.signInWithOtp('shopper@example.com')
  ).resolves.toEqual({ success: false, error: expected });
});
