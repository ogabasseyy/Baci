'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import {
  fetchCustomerLoginEmailPrefillForRedirect,
  sanitizeCustomerLoginEmailPrefill,
} from '@/lib/customer-login-prefill';
import { asRoute } from '@/lib/routes';

// Validate redirect URL to prevent open redirect vulnerabilities
function sanitizeRedirect(redirect: string | null): string {
  const defaultRedirect = '/account';
  if (!redirect) return defaultRedirect;

  // Only allow relative paths starting with /
  // Reject absolute URLs, protocol-relative URLs, and javascript: URLs
  if (
    !redirect.startsWith('/') ||
    redirect.startsWith('//') ||
    /[\\\t\n\r]/.test(redirect) ||
    redirect.includes(':')
  ) {
    return defaultRedirect;
  }

  return redirect;
}

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
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

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
    setError('');
    setIsSending(true);

    const result = await sendOtp(email);

    if (!result.success) {
      setError(result.error || 'Failed to send code');
    }

    setIsSending(false);
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
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
    setError('');
    setIsVerifying(true);

    const result = await verifyOtp(codeString);

    if (!result.success) {
      setError(result.error || 'Verification failed');
      setCode(['', '', '', '', '', '']);
      codeInputRefs.current[0]?.focus();
    } else {
      router.push(asRoute(redirectTo));
    }

    setIsVerifying(false);
  };

  const handleResendCode = async () => {
    setError('');
    setIsSending(true);
    setCode(['', '', '', '', '', '']);

    const result = await sendOtp(otpState?.email || email);

    if (!result.success) {
      setError(result.error || 'Failed to resend code');
    }

    setIsSending(false);
  };

  return {
    merchant,
    merchantLoading,
    authLoading,
    otpState,
    email,
    setEmail,
    code,
    setCode,
    error,
    setError,
    isSending,
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
