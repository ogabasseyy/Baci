import { describe, expect, it } from 'vitest';
import { resolveSerializedOfferStock } from './serialized-offer-stock';

describe('resolveSerializedOfferStock', () => {
  it('returns undefined for non-serialized policies', () => {
    expect(
      resolveSerializedOfferStock({ stock_quantity: 5 }, { stock: 10 })
    ).toBeUndefined();
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'off', stock: 10 }
      )
    ).toBeUndefined();
  });

  it('caps a strict offer by the folded base unit count', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_strict', stock: 2 }
      )
    ).toBe(2);
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 1 },
        { inventory_tracking_policy: 'serialized_strict', stock: 4 }
      )
    ).toBe(1);
  });

  it('disables a strict offer when no serialized unit is available', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_strict', stock: 0 }
      )
    ).toBe(0);
  });

  it('inherits folded base units when the strict offer quantity is null', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: null },
        { inventory_tracking_policy: 'serialized_strict', stock: 3 }
      )
    ).toBe(3);
  });

  it('prices an unlimited offer from its binding scalar', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_then_unlimited', stock: 9999 }
      )
    ).toBe(5);
  });

  it('ignores dwindling base units for unlimited offers with a scalar', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_then_unlimited', stock: 1 }
      )
    ).toBe(5);
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_then_unlimited', stock: 0 }
      )
    ).toBe(5);
  });

  it('returns unbounded (undefined) when the unlimited offer quantity is null', () => {
    // A null scalar under serialized_then_unlimited is unbounded, not
    // capped by the folded units: callers fall through to their
    // scalar/parent logic, which keeps the line purchasable.
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: null },
        { inventory_tracking_policy: 'serialized_then_unlimited', stock: 9999 }
      )
    ).toBeUndefined();
  });

  it('prefers the inherited effective policy over the row-local one', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        {
          effective_policy: 'serialized_strict',
          inventory_tracking_policy: 'off',
          stock: 2,
        }
      )
    ).toBe(2);
  });

  it('coerces string quantities and clamps negatives', () => {
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: '4' },
        { inventory_tracking_policy: 'serialized_strict', stock: '2' }
      )
    ).toBe(2);
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: -3 },
        { inventory_tracking_policy: 'serialized_strict', stock: 2 }
      )
    ).toBe(0);
  });

  it('fails closed when strict base units are unknown', () => {
    // Without a folded unit count the strict minimum cannot be
    // proven, so the selection resolves zero (matching search, which
    // requires a positive strict unit count to advertise).
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: 5 },
        { inventory_tracking_policy: 'serialized_strict', stock: null }
      )
    ).toBe(0);
    expect(
      resolveSerializedOfferStock(
        { stock_quantity: null },
        { inventory_tracking_policy: 'serialized_strict', stock: null }
      )
    ).toBe(0);
  });
});
