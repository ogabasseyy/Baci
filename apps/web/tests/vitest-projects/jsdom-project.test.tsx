import { describe, expect, it } from 'vitest';

// `.tsx` tests are never part of the node project, so this runs in the `jsdom`
// project with vitest.setup.ts.
describe('jsdom Vitest project wiring', () => {
  it('provides a DOM with the jest-dom matchers', () => {
    expect(typeof window).toBe('object');
    expect(document.body).toBeInTheDocument();
  });

  it('applies the window-realm Event setup', () => {
    expect(globalThis.Event).toBe(window.Event);
    expect(globalThis.CustomEvent).toBe(window.CustomEvent);
  });

  it('provides the Web Locks API Supabase auth expects', () => {
    expect(navigator.locks).toBeDefined();
  });
});
