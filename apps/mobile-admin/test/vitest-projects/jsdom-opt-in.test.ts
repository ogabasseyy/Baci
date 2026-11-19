// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

// This is a plain `.ts` test, so it belongs to the `node` Vitest project, but
// the docblock above asks for a DOM. It must then behave as it did before the
// split, which is what every hook test that calls `renderHook` relies on.
describe('jsdom docblock inside the node Vitest project', () => {
  it('provides a DOM', () => {
    expect(typeof window).toBe('object');
    expect(document.body).toBeInstanceOf(HTMLElement);
  });
});
