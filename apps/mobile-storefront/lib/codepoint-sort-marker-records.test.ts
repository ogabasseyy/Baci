import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import { codepointSortMarkerRecords } from './codepoint-sort-marker-records';

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

it('derives the generation-scoped marker key', () => {
  expect(codepointSortMarkerRecords.key(generation)).toBe(
    `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${generation}`
  );
});

it('returns no record for an unseen generation', () => {
  expect(
    codepointSortMarkerRecords.latest('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  ).toBeUndefined();
});

it('keeps only the highest-sequence mark', () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  codepointSortMarkerRecords.noteMarked(id, 2);
  codepointSortMarkerRecords.noteMarked(id, 1);
  expect(codepointSortMarkerRecords.latest(id)).toEqual({
    sequence: 2,
    marked: true,
  });
});

it('retires the mark with a tombstone', () => {
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  codepointSortMarkerRecords.noteMarked(id, 1);
  codepointSortMarkerRecords.noteTombstone(id, 2);
  expect(codepointSortMarkerRecords.latest(id)).toEqual({
    sequence: 2,
    tombstone: true,
  });
});
