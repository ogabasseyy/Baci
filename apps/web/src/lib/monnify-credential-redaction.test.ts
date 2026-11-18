import { describe, expect, it } from 'vitest';
import { redactMonnifyCredentials } from './monnify-credential-redaction';

describe('redactMonnifyCredentials', () => {
  it.each([
    ['Invalid access token: abc123', 'Invalid access token: [redacted]'],
    [
      'Authorization: Bearer sk_live_9f8e7d',
      'Authorization: Bearer [redacted]',
    ],
    [
      'Rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-part_1',
      'Rejected [redacted]',
    ],
    ['api_key=XYZ987&amount=100', 'api_key=[redacted]&amount=100'],
    ['hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', 'hash [redacted]'],
  ])('redacts %s', (input, expected) => {
    expect(redactMonnifyCredentials(input)).toBe(expected);
  });

  it.each([
    'Insufficient wallet balance',
    'vendReference=MFBP-1',
    'Token expired',
    'amount 50,000',
  ])('leaves %s alone', (input) => {
    expect(redactMonnifyCredentials(input)).toBe(input);
  });
});
