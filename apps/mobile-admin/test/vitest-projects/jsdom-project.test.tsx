import { describe, expect, it } from 'vitest';

// `.tsx` tests are never part of the node project, so this runs in the `jsdom`
// project of vitest.config.ts.
describe('mobile admin jsdom Vitest project wiring', () => {
  it('provides a DOM', () => {
    expect(typeof window).toBe('object');
    expect(document.body).toBeInstanceOf(HTMLElement);
  });
});
