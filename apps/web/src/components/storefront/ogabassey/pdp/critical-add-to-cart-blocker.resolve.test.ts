import { describe, expect, it } from 'vitest';
import { resolveCriticalAddToCartBlocker } from './critical-add-to-cart-blocker';

describe('resolveCriticalAddToCartBlocker', () => {
  const base = {
    canAddToCart: false,
    maxQuantity: null,
    missingAxes: [],
    routeOfferMissingActive: false,
  };

  it('returns null when the selection is buyable', () => {
    expect(
      resolveCriticalAddToCartBlocker({ ...base, canAddToCart: true })
    ).toBeNull();
  });

  it('names every missing option group', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        missingAxes: ['storage', 'sim_type', 'color'],
      })
    ).toMatchObject({
      kind: 'missing-selection',
      message:
        'Choose a storage, sim type and color to add this to your cart.',
    });
  });

  it('points a removed offer at the condition choice', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        missingAxes: ['color'],
        routeOfferMissingActive: true,
        visibleAxes: ['condition', 'color'],
      })
    ).toMatchObject({ kind: 'offer-missing', axes: ['condition'] });
  });

  it('does not promise a condition choice the page does not show', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        routeOfferMissingActive: true,
        visibleAxes: ['color'],
      })
    ).toMatchObject({
      kind: 'offer-missing',
      axes: [],
      message: 'This offer is no longer available.',
    });
  });

  it('points an unresolved hidden option back at the visible groups', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        missingHiddenAxes: ['model'],
        visibleAxes: ['storage', 'color'],
      })
    ).toMatchObject({
      kind: 'unconfirmed-selection',
      axes: ['storage', 'color'],
      message: 'Tap your options to confirm the exact version.',
    });
  });

  it('asks for the missing option before reporting stock, which depends on it', () => {
    // Stock belongs to the chosen version: until the shopper picks the
    // missing option, the count is the default version's, and another
    // option may be in stock. Hard-disabling here would strand it.
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        maxQuantity: 0,
        missingAxes: ['color'],
      })
    ).toMatchObject({ kind: 'missing-selection', axes: ['color'] });
  });

  it('falls back to an unavailable-combination reason', () => {
    expect(resolveCriticalAddToCartBlocker(base)).toMatchObject({
      kind: 'unavailable',
    });
  });
});
