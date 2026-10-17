import { expect, it } from 'vitest';
import { conditionDescriptions } from './product-selection-condition-descriptions';

it('describes every selectable condition', () => {
  expect(conditionDescriptions).toEqual({
    new: 'Factory sealed with full manufacturer warranty',
    open_box: 'Opened but unused, all accessories included',
    used: 'Fully tested and inspected, 30-day warranty',
  });
});
