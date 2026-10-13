import { describe, expect, it } from 'vitest';
import { adminSafeErrorCodeSchema } from './admin-safe-error-code';

describe('adminSafeErrorCodeSchema', () => {
  it('accepts the redacted error-code vocabulary', () => {
    expect(adminSafeErrorCodeSchema.parse('provider_request_timeout')).toBe(
      'provider_request_timeout'
    );
  });

  it('rejects a hostile provider diagnostic string', () => {
    expect(
      adminSafeErrorCodeSchema.safeParse(
        'recipient@example.com: request failed'
      ).success
    ).toBe(false);
  });
});
