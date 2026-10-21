'use client';

import { ArrowLeft, Loader2, Mail, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { OgabasseyLoginPage } from '@/components/storefront/ogabassey/components/login/OgabasseyLoginPage';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import {
  fetchCustomerLoginEmailHintForRedirect,
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
    redirect.includes(':')
  ) {
    return defaultRedirect;
  }

  return redirect;
}

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
  const [emailHint, setEmailHint] = useState('');
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

    // The claim login hint is masked guidance (never the full address):
    // display it so the customer knows which inbox to open, but never
    // place it in the input — the OTP code must go to the real address.
    void fetchCustomerLoginEmailHintForRedirect(redirectTo).then((hint) => {
      if (!cancelled && hint) {
        setEmailHint(hint);
      }
    });

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

  // Use merchant's primary color if available, fallback to default blue
  const primaryColor = merchant?.brand_colors?.primary || '#3F51B5';

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Subtle accent line at top using merchant's primary color */}
      <div className="h-1 w-full" style={{ backgroundColor: primaryColor }} />

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
                alt={merchant.business_name}
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
              {otpState?.codeSent
                ? 'Enter verification code'
                : 'Sign in or Create account'}
            </CardTitle>
            <CardDescription>
              {otpState?.codeSent
                ? `We sent a 6-digit code to ${otpState.email}`
                : 'Enter your email to sign in or sign up instantly'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {!otpState?.codeSent ? (
              // Email input form
              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  {emailHint ? (
                    <p className="text-sm text-muted-foreground">
                      This receipt was sent to {emailHint} — sign in with that
                      address to continue.
                    </p>
                  ) : null}
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      autoFocus
                      disabled={isSending || isGoogleLoading}
                    />
                  </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button
                  type="submit"
                  className="w-full text-white"
                  style={{ backgroundColor: primaryColor }}
                  disabled={isSending || isGoogleLoading || !email}
                >
                  {isSending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Sending code…
                    </>
                  ) : (
                    'Continue with email'
                  )}
                </Button>

                {/* Divider */}
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-400">
                      Or continue with
                    </span>
                  </div>
                </div>

                {/* Google Sign-In Button */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isSending || isGoogleLoading}
                  onClick={async () => {
                    setError('');
                    setIsGoogleLoading(true);
                    const result = await signInWithGoogle();
                    if (!result.success) {
                      setError(result.error || 'Failed to sign in with Google');
                      setIsGoogleLoading(false);
                    }
                    // If successful, user will be redirected
                  }}
                >
                  {isGoogleLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <svg
                        className="mr-2 size-4"
                        viewBox="0 0 24 24"
                        aria-labelledby="google-logo-title"
                      >
                        <title id="google-logo-title">Google</title>
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Continue with Google
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-gray-400">
                  By continuing, you agree to the store's terms of service and
                  privacy policy.
                </p>

                {/* Account Creation Notice */}
                <p className="text-center text-gray-500 text-sm">
                  New here?{' '}
                  <span className="text-gray-900 font-medium">
                    Just enter your email above to create an account
                  </span>
                </p>
              </form>
            ) : (
              // OTP verification form
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>Verification code</Label>
                  <div
                    className="flex gap-2 justify-center"
                    onPaste={handlePaste}
                  >
                    {(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const).map(
                      (slot, index) => (
                        <Input
                          key={slot}
                          ref={(el) => {
                            codeInputRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={code[index]}
                          onChange={(e) =>
                            handleCodeChange(index, e.target.value)
                          }
                          onKeyDown={(e) => handleKeyDown(index, e)}
                          className="w-12 h-14 text-center text-2xl font-mono"
                          disabled={isVerifying}
                          autoFocus={index === 0}
                          aria-label={`Digit ${index + 1} of 6`}
                        />
                      )
                    )}
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive text-center">
                    {error}
                  </p>
                )}

                {isVerifying && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Verifying…</span>
                  </div>
                )}

                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Didn't receive the code?
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResendCode}
                    disabled={isSending}
                  >
                    {isSending ? 'Sending...' : 'Resend code'}
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setCode(['', '', '', '', '', '']);
                    setError('');
                  }}
                >
                  Use a different email
                </Button>
              </div>
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
