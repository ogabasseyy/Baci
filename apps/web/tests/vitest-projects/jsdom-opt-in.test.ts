// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

// This file lives in a node-project folder (vitest.node-folders.ts) but asks
// for a DOM with the docblock above. The node setup must then load the full
// jsdom setup, so such a test behaves exactly as it did before the split.
describe('jsdom docblock inside the node Vitest project', () => {
  it('provides a DOM', () => {
    expect(typeof window).toBe('object');
    expect(document.body).toBeInTheDocument();
  });

  it('applies the full jsdom setup, not the slim node one', () => {
    // Set only by vitest.setup.ts (Radix FocusScope needs window-realm events).
    expect(globalThis.Event).toBe(window.Event);
    expect(globalThis.CustomEvent).toBe(window.CustomEvent);
  });
});
