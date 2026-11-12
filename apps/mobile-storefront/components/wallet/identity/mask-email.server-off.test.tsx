import { maskEmail } from './mask-email';

// Pure formatting: no server involved.
describe('maskEmail', () => {
  it('keeps two letters and the domain', () => {
    expect(maskEmail('bassey@example.com')).toBe('ba***@example.com');
    expect(maskEmail('b@x.io')).toBe('***@x.io');
    expect(maskEmail('bob@x.io')).toBe('b***@x.io');
  });

  it('hides anything that is not an address', () => {
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('trailing@')).toBe('***');
    expect(maskEmail('@x.io')).toBe('***');
  });
});
