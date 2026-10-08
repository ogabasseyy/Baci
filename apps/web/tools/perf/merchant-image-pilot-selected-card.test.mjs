import { describe, expect, it } from 'vitest';
import { selectedCardSubtree } from './merchant-image-pilot-selected-card.mjs';

describe('selectedCardSubtree', () => {
  it('returns the wrapper contents, excluding later fillers', () => {
    const html =
      '<section><div data-pilot-lab-selected-card="true"><img src="/a.png"/></div>' +
      '<div><img src="/filler.png"/></div></section>';
    expect(selectedCardSubtree(html)).toBe('<img src="/a.png"/>');
  });

  it('balances nested divs inside the card', () => {
    const html =
      '<div data-pilot-lab-selected-card="true"><div><div>deep</div></div></div><div>after</div>';
    expect(selectedCardSubtree(html)).toBe('<div><div>deep</div></div>');
  });

  it('returns null when the wrapper is absent', () => {
    expect(selectedCardSubtree('<div><img src="/a.png"/></div>')).toBe(null);
  });

  it('returns null when the wrapper never closes', () => {
    expect(
      selectedCardSubtree('<div data-pilot-lab-selected-card="true"><div>oops')
    ).toBe(null);
  });
});
