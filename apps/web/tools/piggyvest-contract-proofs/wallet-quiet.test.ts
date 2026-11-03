import { describe, expect, it } from 'vitest';
import { WalletsQuiet } from './wallet-quiet';

describe('WalletsQuiet', () => {
  it('starts quiet', () => {
    expect(new WalletsQuiet().isQuiet('a', 'b')).toBe(true);
  });

  it('is not quiet once any queried wallet was marked', () => {
    const quiet = new WalletsQuiet();
    quiet.markNotQuiet('a');
    expect(quiet.isQuiet('a')).toBe(false);
    expect(quiet.isQuiet('a', 'b')).toBe(false);
    expect(quiet.isQuiet('b')).toBe(true);
  });
});
