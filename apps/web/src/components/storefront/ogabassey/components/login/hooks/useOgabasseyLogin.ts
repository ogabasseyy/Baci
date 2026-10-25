'use client';

/**
 * useOgabasseyLogin Hook
 *
 * 2026 Best Practices:
 * - Separation of concerns (logic from UI)
 * - Type-safe return values
 * - Testable business logic
 * - Centralized state management
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useOtpSuccessTransition } from '@/components/ui/otp-verification/use-otp-success-transition';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { asRoute } from '@/lib/routes';
import { CUSTOMER_OTP_TTL_SECONDS } from '@/lib/customer-auth-constants';
import type { UseOgabasseyLoginReturn } from '../types';

interface UseOgabasseyLoginOptions {
  initialEmail?: string;
  redirectTo: string;
}

/**
 * Runs a social sign-in flow, surfacing failures and always clearing the
 * loading flag. Module-scope so the try/finally stays outside the hook body.
 */
async function runSocialSignIn(
  signIn: () => Promise<{ success: boolean; error?: string }>,
  fallbackError: string,
  setError: (message: string) => void,
  setLoading: (loading: boolean) => void
): Promise<void> {
  try {
    const result = await signIn();

    if (!result.success) {
      setError(result.error || fallbackError);
    }
    // On success, OAuth redirect will navigate away
  } finally {
    setLoading(false);
  }
}

/**
 * Custom hook for Ogabassey login page logic
 *
 * Handles:
 * - Email/OTP authentication flow
 * - Social sign-in (Google, Apple)
 * - OTP code input management
 * - Error handling
 */
export function useOgabasseyLogin({
  initialEmail = '',
  redirectTo,
}: UseOgabasseyLoginOptions): UseOgabasseyLoginReturn {
  const router = useRouter();
  const { otpState, sendOtp, verifyOtp, signInWithGoogle, signInWithApple } =
    useCustomerAuth();

  // Form state
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const { verified, showSuccess } = useOtpSuccessTransition();
  const [error, setError] = useState('');
  const lastInitialEmailRef = useRef(initialEmail);

  // Loading states
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);

  // Refs for OTP inputs
  const codeRecipient = useRef(otpState?.email || initialEmail);
  const verifyLock = useRef(false);
  useEffect(() => {
    if (otpState?.email) codeRecipient.current = otpState.email;
  }, [otpState?.email]);
  const sendLock = useRef(false);

  useEffect(() => {
    if (otpState?.codeSent) {
      lastInitialEmailRef.current = initialEmail;
      return;
    }

    setEmail((currentEmail) => {
      if (currentEmail === lastInitialEmailRef.current) {
        return initialEmail;
      }

      return currentEmail;
    });
    lastInitialEmailRef.current = initialEmail;
  }, [initialEmail, otpState?.codeSent]);

  /**
   * Send OTP code to email
   */
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendLock.current || verifyLock.current || verified) return;
    sendLock.current = true;
    setError('');
    setIsSending(true);
    try {
      const result = await sendOtp(email);
      if (result.success) {
        codeRecipient.current = email;
        setCode('');
        setEditingEmail(false);
      } else setError(result.error || 'Failed to send code');
    } catch {
      setError('Could not send a code. Please try again.');
    } finally {
      sendLock.current = false;
      setIsSending(false);
    }
  };

  const handleCompleteCode = async (value: string) => {
    if (
      verifyLock.current ||
      sendLock.current ||
      verified ||
      !/^\d{6}$/.test(value)
    )
      return;
    if (otpState?.expiresAt !== undefined && Date.now() >= otpState.expiresAt) {
      setError('This code has expired. Request a new code.');
      return;
    }
    verifyLock.current = true;
    setError('');
    setIsVerifying(true);
    try {
      const result = await verifyOtp(value);
      setCode('');
      if (!result.success) {
        setError(result.error || 'Verification failed');
        return;
      }
      // Only the server-confirmed response may start the success animation.
      await showSuccess();
      router.push(asRoute(redirectTo));
    } catch {
      setCode('');
      setError('Could not verify your code. Please try again.');
    } finally {
      verifyLock.current = false;
      setIsVerifying(false);
    }
  };

  const handleCodeChange = (value: string) => {
    if (!verifyLock.current && !verified && /^\d{0,6}$/.test(value)) {
      setCode(value);
      setError('');
    }
  };

  const handleResendCode = async (): Promise<boolean> => {
    if (sendLock.current || verifyLock.current || verified) return false;
    sendLock.current = true;
    setError('');
    setIsSending(true);
    try {
      const result = await sendOtp(otpState?.email || email);
      if (!result.success) {
        setError(result.error || 'Failed to resend code');
        return false;
      }
      setCode('');
      return true;
    } catch {
      setError('Could not send a new code. Please try again.');
      return false;
    } finally {
      sendLock.current = false;
      setIsSending(false);
    }
  };

  const handleChangeEmail = () => {
    if (verifyLock.current || sendLock.current || verified) return;
    setCode('');
    setError('');
    setEditingEmail(true);
  };

  /**
   * Sign in with Google
   */
  const handleGoogleSignIn = async () => {
    setError('');
    setIsGoogleLoading(true);

    await runSocialSignIn(
      signInWithGoogle,
      'Failed to sign in with Google',
      setError,
      setIsGoogleLoading
    );
  };

  /**
   * Sign in with Apple
   */
  const handleAppleSignIn = async () => {
    setError('');
    setIsAppleLoading(true);

    await runSocialSignIn(
      signInWithApple,
      'Failed to sign in with Apple',
      setError,
      setIsAppleLoading
    );
  };

  return {
    // State
    email,
    code,
    error,
    isSending,
    isVerifying,
    isGoogleLoading,
    isAppleLoading,
    isCodeSent:
      !editingEmail && (Boolean(otpState?.codeSent) || isVerifying || verified),
    verified,
    // Preserve the existing sign-in window; Oxygen's default is five minutes.
    codeSentAt:
      otpState?.expiresAt !== undefined
        ? otpState.expiresAt - CUSTOMER_OTP_TTL_SECONDS * 1000
        : undefined,
    sentToEmail: otpState?.email || codeRecipient.current || email,

    // Handlers
    setEmail,
    handleSendCode,
    handleCodeChange,
    handleCompleteCode,
    handleResendCode,
    handleChangeEmail,
    handleGoogleSignIn,
    handleAppleSignIn,
  };
}
