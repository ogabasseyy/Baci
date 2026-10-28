export interface OtpVerificationFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Opt in to completion handling; verification remains the caller's job. */
  onComplete?: (value: string) => void;
  length?: 4 | 6;
  label?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  pending?: boolean;
  verified?: boolean;
  form?: string;
  error?: string;
  hint?: string;
  pendingMessage?: string;
  successMessage?: string;
  concealDigits?: boolean;
  /** Visual completion only. Never treat animation completion as verification. */
  onStackComplete?: () => void;
  /** Successful send time in epoch milliseconds. No code or token is stored. */
  sentAt?: number;
  ttlSeconds?: number;
  /** Optional caller-specific resend delay, independent of OTP expiry. */
  resendCooldownSeconds?: number;
  resendSentAt?: number;
  onResend?: () => Promise<boolean>;
}
