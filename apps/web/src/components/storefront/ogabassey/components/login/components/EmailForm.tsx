/**
 * EmailForm Component
 *
 * 2026 Best Practices:
 * - Full accessibility with labels
 * - Loading states
 * - Form validation feedback
 */

import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EmailFormProps } from '../types';
import { SocialSignInButtons } from './SocialSignInButtons';

const OGABASSEY_RED = '#D62027';

/**
 * Email entry form with social sign-in options
 */
export function EmailForm({
  email,
  onEmailChange,
  onSubmit,
  error,
  isSending,
  isGoogleLoading,
  isAppleLoading,
  onGoogleSignIn,
  onAppleSignIn,
}: EmailFormProps) {
  const isLoading = isSending || isGoogleLoading || isAppleLoading;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-gray-700">
          Email address
        </Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2 size-4 text-gray-400"
            aria-hidden="true"
          />
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="pl-11 h-12 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 rounded-xl"
            style={{ '--tw-ring-color': `${OGABASSEY_RED}40` } as React.CSSProperties}
            required
            autoFocus
            disabled={isLoading}
            aria-describedby={error ? 'email-error' : undefined}
          />
        </div>
      </div>

      {error && (
        <p id="email-error" className="text-sm text-primary" role="alert">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full h-12 text-white rounded-xl font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] bg-[#D62027] hover:bg-[#D62027]/90 shadow-lg shadow-red-600/10"
        disabled={isLoading || !email}
      >
        {isSending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            Sending code…
          </>
        ) : (
          'Send sign-in code'
        )}
      </Button>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="px-3 text-gray-400 bg-white">Or continue with</span>
        </div>
      </div>

      <SocialSignInButtons
        onGoogleSignIn={onGoogleSignIn}
        onAppleSignIn={onAppleSignIn}
        isGoogleLoading={isGoogleLoading}
        isAppleLoading={isAppleLoading}
        isDisabled={isSending}
      />

      <p className="text-xs text-center text-gray-400">
        By continuing, you agree to the store's terms of service and privacy
        policy.
      </p>

      {/* Account Creation Notice */}
      <p className="text-center text-gray-500 text-sm">
        New to Ogabassey?{' '}
        <span className="text-gray-900 font-medium">
          Just enter your email above to create an account
        </span>
      </p>
    </form>
  );
}
