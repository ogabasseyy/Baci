import { describe, expect, it } from 'vitest';
import {
  oxygenActiveLoanMessage,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import { oxygenInvalidOtpMessage } from '@/lib/payments/oxygen/otp-rejection';
import {
  decodeOxygenResponse,
  OxygenInvalidOtpError,
  OxygenRateLimitError,
  SignInRequired,
} from './oxygen-provider-response';

describe('decodeOxygenResponse', () => {
  it('returns successful JSON without changing the payload', async () => {
    await expect(
      decodeOxygenResponse(Response.json({ value: 'saved' }))
    ).resolves.toEqual({ value: 'saved' });
  });

  it('maps authentication and throttling to their typed errors', async () => {
    await expect(
      decodeOxygenResponse(new Response(null, { status: 401 }))
    ).rejects.toBeInstanceOf(SignInRequired);
    await expect(
      decodeOxygenResponse(new Response(null, { status: 429 }))
    ).rejects.toBeInstanceOf(OxygenRateLimitError);
  });

  it.each([
    ['OXYGEN_ACTIVE_LOAN', oxygenActiveLoanMessage],
    ['OXYGEN_STATEMENT_REQUIRED', oxygenStatementRequiredMessage],
    ['OXYGEN_OTP_INVALID', oxygenInvalidOtpMessage],
  ])('maps %s to safe copy', async (code, message) => {
    const result = decodeOxygenResponse(
      Response.json({ code, detail: 'provider secret' }, { status: 409 })
    );
    await expect(result).rejects.toThrow(message);
    if (code === 'OXYGEN_OTP_INVALID')
      await expect(result).rejects.toBeInstanceOf(OxygenInvalidOtpError);
  });

  it('does not expose unknown or malformed upstream errors', async () => {
    const result = decodeOxygenResponse(
      new Response('provider secret', { status: 409 })
    );
    await expect(result).rejects.toThrow('Your progress is saved.');
    await expect(result).rejects.not.toThrow('provider secret');
  });
});
