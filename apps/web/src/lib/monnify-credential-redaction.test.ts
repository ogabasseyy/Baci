import { describe, expect, it } from 'vitest';
import { redactMonnifyCredentials } from './monnify-credential-redaction';

describe('redactMonnifyCredentials', () => {
  it.each([
    ['Invalid access token: abc123', 'Invalid access token: [redacted]'],
    [
      'Authorization: Bearer fixture-value-1',
      'Authorization: Bearer [redacted]',
    ],
    // Built at runtime so secret scanners don't flag a fixture as a real JWT.
    [
      `Rejected ${['eyJ', 'fixture'].join('')}.${['eyJ', 'payload'].join('')}.sig`,
      'Rejected [redacted]',
    ],
    ['api_key=XYZ987&amount=100', 'api_key=[redacted]&amount=100'],
    [
      'Unauthorized: API key fixturevaluewithoutdigits',
      'Unauthorized: API key [redacted]',
    ],
    ['Invalid token abcdefghijklmnopqrstuvwxyz', 'Invalid token [redacted]'],
    ['Invalid token abc123', 'Invalid token [redacted]'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic [redacted]'],
    ['Authorization: Token abc123', 'Authorization: Token [redacted]'],
    ['Authorization: ApiKey fixture-key-1', 'Authorization: ApiKey [redacted]'],
    ['hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', 'hash [redacted]'],
  ])('redacts %s', (input, expected) => {
    expect(redactMonnifyCredentials(input)).toBe(expected);
  });

  it.each([
    'Insufficient wallet balance',
    'vendReference=MFBP-1',
    'Token expired',
    'amount 50,000',
    'reference 0123456789abcdef01234567 rejected',
  ])('leaves %s alone', (input) => {
    expect(redactMonnifyCredentials(input)).toBe(input);
  });
});
