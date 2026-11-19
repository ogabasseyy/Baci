import { describe, expect, it } from 'vitest';
import { imeiAccountScope } from './imei-account-scope';

describe('imeiAccountScope', () => {
  it('names the store, customer and signed-in user', () => {
    expect(
      imeiAccountScope('ogabassey', { customer: { id: 'c1' }, user: { id: 'u1' } })
    ).toBe('ogabassey:c1:u1');
  });

  it('tells two customer records of one login apart', () => {
    expect(
      imeiAccountScope('ogabassey', { customer: { id: 'c1' }, user: { id: 'u1' } })
    ).not.toBe(
      imeiAccountScope('ogabassey', { customer: { id: 'c2' }, user: { id: 'u1' } })
    );
  });

  it('names a signed-out visitor without throwing', () => {
    expect(imeiAccountScope(undefined, null)).toBe(':anonymous:');
  });
});
