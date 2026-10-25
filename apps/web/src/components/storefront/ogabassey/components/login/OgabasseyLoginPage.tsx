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
import { Suspense, useEffect } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import {
  fetchCustomerLoginEmailPrefillForRedirect,
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
    handleCompleteCode,
    handleResendCode,
    handleChangeEmail,
    handleGoogleSignIn,
    handleAppleSignIn,
    verified,
    codeSentAt,
  } = useOgabasseyLogin({ initialEmail, redirectTo });

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated && !isVerifying && !verified) {
      router.push(asRoute(redirectTo));
    }
  }, [authLoading, isAuthenticated, isVerifying, verified, router, redirectTo]);

  useEffect(() => {
    let cancelled = false;

    if (initialEmail || email) {
      return () => {
        cancelled = true;
      };
    }

    void fetchCustomerLoginEmailPrefillForRedirect(redirectTo).then(
      (emailHint) => {
        if (!cancelled && emailHint) {
          setEmail(emailHint);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [email, initialEmail, redirectTo, setEmail]);

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
              {verified ? 'You’re signed in' : isCodeSent ? 'Enter verification code' : 'Sign in or Create account'}
            </h1>
            <p className="text-gray-500 text-sm">
              {verified
                ? 'Returning to your previous page…'
                : isCodeSent
                ? `We sent a 6-digit code to ${sentToEmail}`
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
              continueHref={redirectTo}
              code={code}
              onCodeChange={handleCodeChange}
              onComplete={handleCompleteCode}
              onResend={handleResendCode}
              onChangeEmail={handleChangeEmail}
              error={error}
              isVerifying={isVerifying}
              isSending={isSending}
              verified={verified}
              sentAt={codeSentAt}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <LoginFooter />
    </div>
  );
}
