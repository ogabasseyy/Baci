import { maskEmail } from './mask-email';

// Pure formatting: no server involved.
describe('maskEmail', () => {
  it('keeps two letters and the domain', () => {
    expect(maskEmail('bassey@example.com')).toBe('ba***@example.com');
    expect(maskEmail('b@x.io')).toBe('b***@x.io');
  });
});
