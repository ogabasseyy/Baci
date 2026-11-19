import { expect, it } from 'vitest';
import { CONDITION_LABELS } from './condition-labels';

it('publishes the partner label for every supported condition', () => {
  expect(CONDITION_LABELS).toEqual({
    new: 'New',
    used: 'Used',
    uk_used: 'UK Used',
    open_box: 'Open Box',
    refurbished: 'Refurbished',
  });
});
