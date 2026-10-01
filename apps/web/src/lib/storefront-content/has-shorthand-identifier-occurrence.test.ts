import { describe, expect, it, vi } from 'vitest';
import { hasShorthandIdentifierOccurrence } from './has-shorthand-identifier-occurrence';

describe('hasShorthandIdentifierOccurrence', () => {
  it('matches a tier suffix inherited from the preceding model', () => {
    const qualifiesPrefix = vi.fn(() => true);

    const result = hasShorthandIdentifierOccurrence(
      ['apple', 'iphone', '15', 'versus', 'pro', 'comparison'],
      ['15', 'pro'],
      qualifiesPrefix
    );

    expect(result).toBe(true);
    expect(qualifiesPrefix).toHaveBeenCalledWith(2, 3, [
      'apple',
      'iphone',
      '15',
      'pro',
      'comparison',
    ]);
  });

  it('rejects a suffix attached to another product phrase', () => {
    const result = hasShorthandIdentifierOccurrence(
      ['apple', 'iphone', '15', 'versus', 'samsung', 'pro', 'comparison'],
      ['15', 'pro'],
      () => true
    );

    expect(result).toBe(false);
  });

  it('rejects a shorthand segment that names a superset model tier', () => {
    const result = hasShorthandIdentifierOccurrence(
      ['apple', 'iphone', '15', 'versus', 'pro', 'max', 'comparison'],
      ['15', 'pro'],
      () => true
    );

    expect(result).toBe(false);
  });
});
