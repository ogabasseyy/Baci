import { describe, expect, it } from 'vitest';
import { hasPhrase } from './has-content-cluster-phrase';

describe('has-content-cluster-phrase', () => {
  it('matches phrases at word boundaries', () => {
    expect(hasPhrase('high-end gaming laptop review', 'gaming laptop')).toBe(
      true
    );
    expect(hasPhrase('gaming laptops in nigeria', 'gaming laptop')).toBe(false);
  });

  it('rejects partial token substring matches', () => {
    expect(hasPhrase('blade runner game', 'blade')).toBe(true);
    expect(hasPhrase('rollerblades are fun', 'blade')).toBe(false);
  });
});
