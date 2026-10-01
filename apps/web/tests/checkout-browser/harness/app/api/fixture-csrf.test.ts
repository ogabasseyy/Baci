import { describe, expect, it } from 'vitest';
import { hasValidFixtureCsrf } from './fixture-csrf';

describe('hasValidFixtureCsrf', () => {
  it('accepts matching cookie and header tokens', () => {
    const request = new Request('http://localhost/api/orders/reuse', {
      headers: {
        cookie: 'csrf-token=fixture-token',
        'x-csrf-token': 'fixture-token',
      },
    });

    expect(hasValidFixtureCsrf(request)).toBe(true);
  });

  it('rejects missing or mismatched tokens', () => {
    const missingHeader = new Request('http://localhost/api/orders/reuse', {
      headers: { cookie: 'csrf-token=fixture-token' },
    });
    const mismatched = new Request('http://localhost/api/orders/reuse', {
      headers: {
        cookie: 'csrf-token=fixture-token',
        'x-csrf-token': 'other-token',
      },
    });

    expect(hasValidFixtureCsrf(missingHeader)).toBe(false);
    expect(hasValidFixtureCsrf(mismatched)).toBe(false);
  });
});
