import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealCriticalAddToCartBlocker } from './reveal-critical-add-to-cart-blocker';

// jsdom has no scrollIntoView; stub it per test and put the original back
// so later suites in the same worker never see the stub.
const originalScrollIntoView = Element.prototype.scrollIntoView;
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  document.body.innerHTML = '';
});

describe('revealCriticalAddToCartBlocker', () => {
  it('moves nothing when the blocker names no rendered option group', () => {
    document.body.innerHTML = '<main><button>Add to cart</button></main>';

    revealCriticalAddToCartBlocker({
      kind: 'unavailable',
      axes: [],
      message: 'unavailable',
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
  });

  it('only reveals option groups in the tapped button\'s own product section', () => {
    document.body.innerHTML = `
      <section data-ogabassey-pdp-critical-shell id="other">
        <div data-ogabassey-pdp-commerce-variant-axis data-axis="color">
          <button data-ogabassey-pdp-commerce-variant-option>Other</button>
        </div>
      </section>
      <section data-ogabassey-pdp-critical-shell id="mine">
        <div data-ogabassey-pdp-commerce-variant-axis data-axis="color">
          <button data-ogabassey-pdp-commerce-variant-option>Mine</button>
        </div>
        <button id="add">Add to cart</button>
      </section>`;

    revealCriticalAddToCartBlocker(
      { kind: 'missing-selection', axes: ['color'], message: 'm' },
      document.getElementById('add')
    );

    expect(document.activeElement).toHaveTextContent('Mine');
    document.body.innerHTML = '';
  });

  it('focuses a choice still open, not one already made', () => {
    document.body.innerHTML = `
      <div data-ogabassey-pdp-commerce-variant-axis data-axis="storage">
        <button data-ogabassey-pdp-commerce-variant-option data-selected="true">256GB</button>
        <button data-ogabassey-pdp-commerce-variant-option disabled>512GB</button>
        <button data-ogabassey-pdp-commerce-variant-option>1TB</button>
      </div>`;

    revealCriticalAddToCartBlocker({
      kind: 'unconfirmed-selection',
      axes: ['storage'],
      message: 'm',
    });

    expect(document.activeElement).toHaveTextContent('1TB');
    document.body.innerHTML = '';
  });

  it('skips the smooth scroll when the shopper asks for reduced motion', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    document.body.innerHTML = `
      <div data-ogabassey-pdp-commerce-variant-axis data-axis="color">
        <button data-ogabassey-pdp-commerce-variant-option>Black</button>
      </div>`;

    revealCriticalAddToCartBlocker({
      kind: 'missing-selection',
      axes: ['color'],
      message: 'm',
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
    });
    window.matchMedia = originalMatchMedia;
    document.body.innerHTML = '';
  });
});
