'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useOtpResendCooldown } from '@/components/ui/otp-verification/use-otp-resend-cooldown';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import {
  CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS,
  CUSTOMER_OTP_TTL_SECONDS,
} from '@/lib/customer-auth-constants';
import {
  fetchCustomerLoginEmailPrefillForRedirect,
  sanitizeCustomerLoginEmailPrefill,
} from '@/lib/customer-login-prefill';
import { sanitizeRedirect } from '@/lib/customer-login-redirect';
import { asRoute } from '@/lib/routes';

export function useCustomerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));
  const prefillEmail = sanitizeCustomerLoginEmailPrefill(
    searchParams.get('email')
  );

  const { merchant, loading: merchantLoading } = useMerchant();
  const {
    isAuthenticated,
    isLoading: authLoading,
    otpState,
    sendOtp,
    verifyOtp,
    signInWithGoogle,
  } = useCustomerAuth();

  const [email, setEmail] = useState(prefillEmail);
  const [editingEmail, setEditingEmail] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const sendLock = useRef(false);
  const verifyLock = useRef(false);
  const sentAt =
    otpState?.expiresAt === undefined
      ? undefined
      : otpState.expiresAt - CUSTOMER_OTP_TTL_SECONDS * 1000;
  const cooldown = useOtpResendCooldown(
    sentAt,
    CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS,
    !!otpState?.codeSent && !editingEmail
  );
  const resendCooldownSeconds = cooldown.remainingSeconds;
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push(asRoute(redirectTo));
    }
  }, [authLoading, isAuthenticated, router, redirectTo]);

  useEffect(() => {
    let cancelled = false;

    if (prefillEmail) {
      return () => {
        cancelled = true;
      };
    }

    void fetchCustomerLoginEmailPrefillForRedirect(redirectTo).then(
      (emailHint) => {
        if (!cancelled && emailHint) {
          setEmail((currentEmail) => currentEmail || emailHint);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [prefillEmail, redirectTo]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendLock.current || verifyLock.current) return;
    sendLock.current = true;
    setError('');
    setIsSending(true);
    try {
      const result = await sendOtp(email);
      if (!result.success) {
        setError(result.error || 'Failed to send code');
      } else {
        setEditingEmail(false);
      }
    } catch {
      setError('Failed to send code');
    } finally {
      sendLock.current = false;
      setIsSending(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (sendLock.current || verifyLock.current) return;
    // Native OTP autofill can deliver the entire code in the first field.
    if (index === 0 && /^\d{6}$/.test(value)) {
      setCode(value.split(''));
      handleVerifyCode(value);
      return;
    }
    // Only allow individual digits otherwise.
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (newCode.every((d) => d) && newCode.join('').length === 6) {
      handleVerifyCode(newCode.join(''));
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    if (sendLock.current || verifyLock.current) return;
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newCode = [...code];
    for (let i = 0; i < pastedData.length && i < 6; i++) {
      newCode[i] = pastedData[i];
    }
    setCode(newCode);

    // Auto-submit if complete
    if (newCode.every((d) => d) && newCode.join('').length === 6) {
      handleVerifyCode(newCode.join(''));
    }
  };

  const handleVerifyCode = async (codeString: string) => {
    if (verifyLock.current || sendLock.current) return;
    if (otpState?.expiresAt !== undefined && Date.now() >= otpState.expiresAt) {
      setError('This code has expired. Request a new code.');
      setCode(['', '', '', '', '', '']);
      return;
    }
    verifyLock.current = true;
    setError('');
    setIsVerifying(true);

    try {
      const result = await verifyOtp(codeString);

      if (!result.success) {
        setError(result.error || 'Verification failed');
        setCode(['', '', '', '', '', '']);
        codeInputRefs.current[0]?.focus();
      } else {
        router.push(asRoute(redirectTo));
      }
    } catch {
      setError('Verification failed');
      setCode(['', '', '', '', '', '']);
      codeInputRefs.current[0]?.focus();
    } finally {
      verifyLock.current = false;
      setIsVerifying(false);
    }
  };

  const handleResendCode = async () => {
    if (sendLock.current || verifyLock.current || !cooldown.canResend()) return;
    sendLock.current = true;
    setError('');
    setIsSending(true);
    setCode(['', '', '', '', '', '']);
    try {
      const result = await sendOtp(otpState?.email || email);
      if (!result.success) {
        setError(result.error || 'Failed to resend code');
      }
    } catch {
      setError('Failed to resend code');
    } finally {
      sendLock.current = false;
      setIsSending(false);
    }
  };

  return {
    merchant,
    merchantLoading,
    authLoading,
    otpState,
    showCodeStep: !!otpState?.codeSent && !editingEmail,
    handleDifferentEmail: () => {
      setEditingEmail(true);
      setCode(['', '', '', '', '', '']);
      setError('');
    },
    email,
    setEmail,
    code,
    setCode,
    error,
    setError,
    isSending,
    resendCooldownSeconds,
    isVerifying,
    isGoogleLoading,
    setIsGoogleLoading,
    codeInputRefs,
    handleSendCode,
    handleCodeChange,
    handleKeyDown,
    handlePaste,
    handleResendCode,
    signInWithGoogle,
  };
}
