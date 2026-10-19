import { describe, expect, it } from 'vitest';
import { getConfirmedStockLabel } from './confirmed-stock-label';

describe('bugfix: stock badges stay consistent in both widget renderers', () => {
  // The fallback embeds the compiled function in its browser script.
  const serialized = new Function(`return (${getConfirmedStockLabel.toString()})`)() as typeof getConfirmedStockLabel;

  for (const [name, getLabel] of [['imported', getConfirmedStockLabel], ['serialized fallback', serialized]] as const) {
    describe(name, () => {
      it.each([null, undefined])('omits unknown stock %s even with a label', (inStock) => {
        expect(getLabel(inStock, 'Confirm availability')).toBeNull();
      });
      it.each(['High Stock', 'Low Stock', 'Last Units'])('preserves confirmed %s', (level) => {
        expect(getLabel(true, level)).toBe(level);
      });
      it('preserves sold-out status and handles absent labels', () => {
        expect(getLabel(false, 'Out of Stock')).toBe('Out of Stock');
        expect(getLabel(false)).toBe('Out of Stock');
        expect(getLabel(true)).toBe('In Stock');
      });
    });
  }
});
