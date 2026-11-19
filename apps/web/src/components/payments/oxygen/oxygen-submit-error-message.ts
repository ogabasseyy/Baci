import { oxygenInvalidOtpMessage } from '@/lib/payments/oxygen/otp-rejection';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import {
  OxygenInvalidOtpError,
  OxygenRateLimitError,
  oxygenRateLimitMessage,
} from './oxygen-provider-response';

export function oxygenSubmitErrorMessage(
  failure: unknown,
  action: OxygenRuntimeAction['action'],
  recovered: Pick<OxygenRuntimeSnapshot, 'pending' | 'stage'> | null
): string {
  if (failure instanceof OxygenRateLimitError) return oxygenRateLimitMessage;
  if (failure instanceof OxygenInvalidOtpError) return oxygenInvalidOtpMessage;
  if (
    action === 'validate_customer' &&
    !recovered?.pending &&
    recovered?.stage !== 'reconciliation_required'
  )
    return 'We couldn’t check your code right now. Please try again shortly.';
  if (action === 'resend_customer_otp')
    return 'We couldn’t send a new code right now. Please wait a moment and try again.';
  return failure instanceof Error
    ? failure.message
    : 'We couldn’t complete this step. Your progress is saved.';
}
