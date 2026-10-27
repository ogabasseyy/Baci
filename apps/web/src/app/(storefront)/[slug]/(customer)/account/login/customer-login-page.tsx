'use client';

import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { OgabasseyLoginPage } from '@/components/storefront/ogabassey/components/login/OgabasseyLoginPage';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { CustomerCodeForm } from './customer-code-form';
import { CustomerEmailForm } from './customer-email-form';
import { useCustomerLoginForm } from './use-customer-login-form';

export default function CustomerLoginPage() {
  const { merchant, loading: merchantLoading } = useMerchant();

  // Template-based login page switching
  // Ogabassey merchants get the premium glassmorphism design
  // Check template_id, slug, custom_domain, and business_name for compatibility
  const isOgabassey =
    merchant?.template_id === 'ogabassey' ||
    merchant?.slug === 'ogabassey' ||
    merchant?.custom_domain?.includes('ogabassey') ||
    merchant?.business_name?.toLowerCase().includes('ogabassey');

  if (!merchantLoading && isOgabassey) {
    return <OgabasseyLoginPage />;
  }

  // Default login page for other merchants
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <DefaultLoginPage />
    </Suspense>
  );
}

function LoginPageFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-store-background">
      <Loader2 className="size-8 animate-spin text-store-primary" />
      <p className="text-sm text-store-background-text/70">
        Loading sign-in...
      </p>
    </div>
  );
}

function DefaultLoginPage() {
  const {
    merchant,
    merchantLoading,
    authLoading,
    otpState,
    showCodeStep,
    handleDifferentEmail,
    email,
    setEmail,
    code,
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
  } = useCustomerLoginForm();

  if (merchantLoading || authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
        <Loader2 className="size-8 animate-spin text-gray-400" />
        <p className="text-sm text-gray-500">
          {merchantLoading
            ? 'Loading store data...'
            : 'Checking authentication...'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Subtle accent line at top using merchant's primary color */}
      <div className="h-1 w-full bg-store-primary" />

      {/* Header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <Link
            href={asRoute('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>Back to store</span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            {merchant?.logo_url ? (
              <Image
                src={merchant.logo_url}
                alt={merchant.business_name || 'Store logo'}
                width={48}
                height={48}
                sizes="48px"
                className="h-12 w-auto mx-auto mb-2"
                unoptimized
              />
            ) : (
              <div className="size-12 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="size-6 text-primary" />
              </div>
            )}
            <CardTitle className="text-2xl">
              {showCodeStep
                ? 'Enter verification code'
                : 'Sign in or Create account'}
            </CardTitle>
            <CardDescription>
              {showCodeStep
                ? `We sent a 6-digit code to ${otpState?.email}`
                : 'Enter your email to sign in or sign up instantly'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {!showCodeStep ? (
              // Email input form
              <CustomerEmailForm
                email={email}
                error={error}
                isSending={isSending}
                isGoogleLoading={isGoogleLoading}
                onEmailChange={setEmail}
                onSendCode={handleSendCode}
                onGoogleSignIn={async () => {
                  setError('');
                  setIsGoogleLoading(true);
                  const result = await signInWithGoogle();
                  if (!result.success) {
                    setError(result.error || 'Failed to sign in with Google');
                    setIsGoogleLoading(false);
                  }
                }}
              />
            ) : (
              // OTP verification form
              <CustomerCodeForm
                code={code}
                error={error}
                isVerifying={isVerifying}
                isSending={isSending}
                codeInputRefs={codeInputRefs}
                handlePaste={handlePaste}
                handleCodeChange={handleCodeChange}
                handleKeyDown={handleKeyDown}
                handleResendCode={handleResendCode}
                onDifferentEmail={handleDifferentEmail}
              />
            )}
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-4 bg-white">
        <div className="container mx-auto px-4 text-center text-sm text-gray-400">
          Secure passwordless login powered by{' '}
          {merchant?.business_name || 'Baci'}
        </div>
      </footer>
    </div>
  );
}
