import { expect, it } from 'vitest';
import { applyProbeReadResults } from './session-read-results';

it('does not surface credential-bearing or non-HTTPS selfie links', () => {
  for (const url of [
    'http://example.test/selfie',
    'https://user:password@example.test/selfie',
  ]) {
    const result = { code: 'response_received' };
    applyProbeReadResults(
      'selfie',
      { ok: true, status: 200 },
      { url },
      'workflow',
      'partner',
      result
    );
    expect(result).toEqual({ code: 'response_received' });
  }
});
it('rejects malformed bank lists without inventing options', () => {
  const result = { code: 'response_received' };
  expect(
    applyProbeReadResults(
      'banks',
      { ok: true, status: 200 },
      {},
      'workflow',
      'partner',
      result
    )
  ).toEqual({ code: 'invalid_bank_response', status: 200 });
});
