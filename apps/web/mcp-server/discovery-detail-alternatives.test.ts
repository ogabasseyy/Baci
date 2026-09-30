import { expect, it } from 'vitest';
import { discoveryDetailAlternatives } from './discovery-detail-alternatives';
it('splits complete feature alternatives', () => {
  expect(discoveryDetailAlternatives(['wifi', 'or', 'bluetooth'])).toEqual([['wifi'], ['bluetooth']]);
  expect(discoveryDetailAlternatives(['wifi', 'or'])).toBeUndefined();
  expect(discoveryDetailAlternatives(['wifi'])).toBeUndefined();
});
it('inherits a capacity context without merging explicit contexts or later alternatives', () => {
  expect(discoveryDetailAlternatives(['16gb', 'or', '32gb', 'ram'])).toEqual([['16gb', 'ram'], ['32gb', 'ram']]);
  expect(discoveryDetailAlternatives(['16gb', 'ssd', 'or', '32gb', 'ram', 'or', '64gb', 'ram']))
    .toEqual([['16gb', 'ssd'], ['32gb', 'ram', 'or', '64gb', 'ram']]);
});
