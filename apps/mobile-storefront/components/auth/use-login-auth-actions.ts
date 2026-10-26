import { useShallow } from 'zustand/react/shallow';
import { classifyFetchFailure } from '@/lib/fetch-failure-classification';
import { useAuthStore } from '@/stores/auth-store';

type LoginResult = { success: boolean; error?: string };

const INVALID_CREDENTIALS_MESSAGE =
  'Invalid email or password. Check your details and try again.';
const EXPIRED_CODE_MESSAGE =
  'This code has expired. Request a new code and try again.';
const SAFE_LOGIN_MESSAGES = new Map([
  ['invalid login credentials', INVALID_CREDENTIALS_MESSAGE],
  ['invalid_credentials', INVALID_CREDENTIALS_MESSAGE],
  ['invalid code', 'Invalid code'],
  ['invalid otp', 'Invalid code'],
  ['otp_expired', EXPIRED_CODE_MESSAGE],
  ['email link is invalid or has expired', EXPIRED_CODE_MESSAGE],
  ['token has expired or is invalid', EXPIRED_CODE_MESSAGE],
  ['email not confirmed', 'Please confirm your email before signing in.'],
  [
    'over_request_rate_limit',
    'Too many attempts. Please wait a moment and try again.',
  ],
]);

function getLoginErrorMessage(error: unknown) {
  const failure = classifyFetchFailure(error, { callerAborted: false });
  if (['network', 'dns', 'timeout'].includes(failure.category)) {
    return "We couldn't connect. Check your internet connection and try again.";
  }

  return (
    SAFE_LOGIN_MESSAGES.get(failure.message.trim().toLowerCase()) ??
    "We couldn't sign you in. Please try again."
  );
}

async function presentLoginResult(
  action: () => Promise<LoginResult>
): Promise<LoginResult> {
  try {
    const result = await action();
    return result.success
      ? result
      : { success: false, error: getLoginErrorMessage(result.error) };
  } catch (error) {
    return { success: false, error: getLoginErrorMessage(error) };
  }
}

export function useLoginAuthActions() {
  const actions = useAuthStore(
    useShallow((state) => ({
      signInWithOtp: state.signInWithOtp,
      signInWithPassword: state.signInWithPassword,
      verifyOtp: state.verifyOtp,
    }))
  );

  return {
    signInWithOtp: (email: string) =>
      presentLoginResult(() => actions.signInWithOtp(email)),
    signInWithPassword: (email: string, password: string) =>
      presentLoginResult(() => actions.signInWithPassword(email, password)),
    verifyOtp: (email: string, token: string) =>
      presentLoginResult(() => actions.verifyOtp(email, token)),
  };
}
