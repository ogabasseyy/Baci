import {
  goalActionMessageOf,
  pinCodeOf,
  pinMessageOf,
} from './wallet-pin-sheet-errors';

const fail = (code: string | undefined, message: string) =>
  Object.assign(new Error(message), code ? { code } : {});

// Pure copy helpers: no server involved.
describe('wallet PIN sheet errors', () => {
  it('reads the code and message, with a safe fallback', () => {
    expect(pinCodeOf(fail('PIN_LOCKED', 'Locked'))).toBe('PIN_LOCKED');
    expect(pinCodeOf('nope')).toBeUndefined();
    expect(pinMessageOf(fail(undefined, 'Locked'))).toBe('Locked');
    expect(pinMessageOf(null)).toBe('Something went wrong. Please try again.');
  });

  it('never shows raw server text for a goal action', () => {
    expect(
      goalActionMessageOf(fail('PIN_LOCKED', 'Too many wrong PINs.'))
    ).toBe('Too many wrong PINs.');
    expect(
      goalActionMessageOf(fail('DB_EXPLODED', 'relation "x" missing'))
    ).not.toContain('relation');
  });
});
