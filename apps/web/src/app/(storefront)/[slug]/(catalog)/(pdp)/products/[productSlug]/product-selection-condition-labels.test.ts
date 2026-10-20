import { expect, it } from 'vitest';
import { conditionLabels } from './product-selection-condition-labels';

it('labels every selectable condition', () => {
  expect(conditionLabels).toEqual({
    new: 'New',
    used: 'Premium Used',
    open_box: 'Open Box',
  });
});
