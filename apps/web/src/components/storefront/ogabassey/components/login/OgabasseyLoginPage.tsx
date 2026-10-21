'use client';

/**
 * OgabasseyLoginPage Component
 *
 * 2026 Best Practices:
 * - Modular architecture with separated concerns
 * - Custom hook for business logic
 * - Composable UI components
 * - Full accessibility support
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import {
  fetchCustomerLoginEmailHintForRedirect,
  sanitizeCustomerLoginEmailPrefill,
} from '@/lib/customer-login-prefill';
import { asRoute } from '@/lib/routes';
import { Logo as OgabasseyLogo } from '../Logo';
import {
  EmailForm,
  LoadingScreen,
  LoginFooter,
  LoginHeader,
  OtpVerificationForm,
} from './components';
import { useOgabasseyLogin } from './hooks';
import { sanitizeRedirect } from './utils';

/**
 * Ogabassey Premium Login Page
 *
 * Composed of modular sub-components:
 * - LoadingScreen: Loading state display
 * - LoginHeader: Back navigation
 * - EmailForm: Email entry with social sign-in
 * - OtpVerificationForm: OTP code verification
 * - LoginFooter: Footer branding
 */
export function OgabasseyLoginPage() {
  return (
    <Suspense
      fallback={<LoadingScreen message="Loading Ogabassey sign-in..." />}
    >
      <OgabasseyLoginPageContent />
    </Suspense>
  );
}

function OgabasseyLoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));
  const initialEmail = sanitizeCustomerLoginEmailPrefill(
    searchParams.get('email')
  );

  const { loading: merchantLoading } = useMerchant();
  const { isAuthenticated, isLoading: authLoading } = useCustomerAuth();

  const {
    email,
    code,
    error,
    isSending,
    isVerifying,
    isGoogleLoading,
    isAppleLoading,
    isCodeSent,
    sentToEmail,
    setEmail,
    handleSendCode,
    handleCodeChange,
    handleKeyDown,
    handlePaste,
    handleResendCode,
    handleChangeEmail,
    handleGoogleSignIn,
    handleAppleSignIn,
    codeInputRefs,
  } = useOgabasseyLogin({ initialEmail, redirectTo });

  // The claim login hint is masked guidance (never the full address):
  // display it so the customer knows which inbox to open, but never
  // place it in the input — the OTP code must go to the real address.
  const [emailHint, setEmailHint] = useState('');

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push(asRoute(redirectTo));
    }
  }, [authLoading, isAuthenticated, router, redirectTo]);

  useEffect(() => {
    let cancelled = false;

    if (initialEmail || email) {
      return () => {
        cancelled = true;
      };
    }

    void fetchCustomerLoginEmailHintForRedirect(redirectTo).then((hint) => {
      if (!cancelled && hint) {
        setEmailHint(hint);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [email, initialEmail, redirectTo]);

  // Show loading screen while checking auth/merchant
  if (merchantLoading || authLoading) {
    return (
      <LoadingScreen
        message={merchantLoading ? 'Loading store data...' : 'Checking authentication...'}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#FAFAFA]">
      {/* Soft Red Gradient Background - Premium Brand Touch */}
      <div className="absolute top-[-10%] right-[-10%] size-[50%] bg-[#D62027]/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] size-[50%] bg-[#D62027]/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Subtle primary accent line at top */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#D62027]" />

      {/* Header */}
      <LoginHeader />

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4 relative z-10">
        {/* Clean Card with subtle shadow */}
        <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl p-8 shadow-xl">
          {/* Logo */}
          <div className="text-center mb-8">
            <OgabasseyLogo className="h-10 mx-auto mb-6 text-primary" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {isCodeSent ? 'Enter verification code' : 'Sign in or Create account'}
            </h1>
            <p className="text-gray-500 text-sm">
              {isCodeSent
                ? `We sent a 6-digit code to ${sentToEmail}`
                : emailHint
                  ? `This receipt was sent to ${emailHint} — sign in with that address.`
                  : 'Enter your email to sign in or sign up instantly'}
            </p>
          </div>

          {!isCodeSent ? (
            <EmailForm
              email={email}
              onEmailChange={setEmail}
              onSubmit={handleSendCode}
              error={error}
              isSending={isSending}
              isGoogleLoading={isGoogleLoading}
              isAppleLoading={isAppleLoading}
              onGoogleSignIn={handleGoogleSignIn}
              onAppleSignIn={handleAppleSignIn}
            />
          ) : (
            <OtpVerificationForm
              email={sentToEmail || email}
              code={code}
              onCodeChange={handleCodeChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onResend={handleResendCode}
              onChangeEmail={handleChangeEmail}
              error={error}
              isVerifying={isVerifying}
              isSending={isSending}
              inputRefs={codeInputRefs}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <LoginFooter />
    </div>
  );
}
