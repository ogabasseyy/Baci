import {
  oxygenActiveLoanCode,
  oxygenActiveLoanMessage,
  oxygenStatementRequiredCode,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import {
  oxygenInvalidOtpCode,
  oxygenInvalidOtpMessage,
} from '@/lib/payments/oxygen/otp-rejection';
import {
  OxygenPaymentOriginUnverifiedError,
  oxygenPaymentOriginCode,
} from '@/lib/payments/oxygen/payment-origin-error';

export class SignInRequired extends Error {}
export class OxygenRateLimitError extends Error {}
export class OxygenInvalidOtpError extends Error {}
export const oxygenRateLimitMessage =
  'Please wait a moment before trying again.';
export async function decodeOxygenResponse(
  response: Response
): Promise<unknown> {
  if (response.status === 401) throw new SignInRequired();
  if (response.status === 429)
    throw new OxygenRateLimitError(oxygenRateLimitMessage);
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenPaymentOriginCode
    )
      throw new OxygenPaymentOriginUnverifiedError();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenActiveLoanCode
    )
      throw new Error(oxygenActiveLoanMessage);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenInvalidOtpCode
    )
      throw new OxygenInvalidOtpError(oxygenInvalidOtpMessage);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenStatementRequiredCode
    )
      throw new Error(oxygenStatementRequiredMessage);
  }
  if (!response.ok)
    throw new Error(
      'We couldn’t complete this step right now. Your progress is saved.'
    );
  return response.json() as Promise<unknown>;
}
