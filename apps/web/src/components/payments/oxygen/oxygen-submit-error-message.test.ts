import { describe, expect, it } from 'vitest';
import { oxygenInvalidOtpMessage } from '@/lib/payments/oxygen/otp-rejection';
import {
  OxygenInvalidOtpError,
  OxygenRateLimitError,
  oxygenRateLimitMessage,
} from './oxygen-provider-response';
import { oxygenSubmitErrorMessage } from './oxygen-submit-error-message';

describe('oxygenSubmitErrorMessage', () => {
  it('preserves explicit rate-limit and incorrect-code feedback', () => {
    expect(
      oxygenSubmitErrorMessage(
        new OxygenRateLimitError(),
        'validate_customer',
        null
      )
    ).toBe(oxygenRateLimitMessage);
    expect(
      oxygenSubmitErrorMessage(
        new OxygenInvalidOtpError(),
        'validate_customer',
        null
      )
    ).toBe(oxygenInvalidOtpMessage);
  });

  it('does not claim a retry is safe when a validation is still pending', () => {
    expect(
      oxygenSubmitErrorMessage(
        new Error('Still checking'),
        'validate_customer',
        {
          pending: {
            action: 'validate_customer',
            status: 'executing',
            idempotencyKey: 'key',
          },
          stage: 'reconciliation_required',
        }
      )
    ).toBe('Still checking');
  });

  it('gives a specific resend failure and a safe fallback for unknown errors', () => {
    expect(
      oxygenSubmitErrorMessage(new Error('x'), 'resend_customer_otp', null)
    ).toBe(
      'We couldn’t send a new code right now. Please wait a moment and try again.'
    );
    expect(oxygenSubmitErrorMessage(null, 'selfie_link', null)).toBe(
      'We couldn’t complete this step. Your progress is saved.'
    );
  });
});
