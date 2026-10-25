import { OtpVerificationField } from '@/components/ui/otp-verification';
import { Button } from '@/components/ui/button';
import { CUSTOMER_OTP_TTL_SECONDS } from '@/lib/customer-auth-constants';
import type { OtpVerificationFormProps } from '../types';

export function OtpVerificationForm({
  continueHref,
  code,
  onCodeChange,
  onComplete,
  onResend,
  onChangeEmail,
  error,
  isVerifying,
  isSending,
  verified,
  sentAt,
}: OtpVerificationFormProps) {
  return (
    <div className="space-y-6">
      <OtpVerificationField
        value={code}
        onChange={onCodeChange}
        onComplete={(value) => void onComplete(value)}
        label="Email verification code"
        pending={isVerifying && !verified}
        verified={verified}
        disabled={isSending}
        error={error}
        sentAt={sentAt}
        ttlSeconds={CUSTOMER_OTP_TTL_SECONDS}
        onResend={verified ? undefined : onResend}
        successMessage="Signed in successfully."
      />
      {verified ? (
        <a
          href={continueHref}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--store-primary)] px-4 font-semibold text-[var(--store-primary-text,#ffffff)]"
        >
          Continue
        </a>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12 bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-xl"
          onClick={onChangeEmail}
          disabled={isSending || isVerifying || verified}
        >
          Use a different email
        </Button>
      )}
    </div>
  );
}
