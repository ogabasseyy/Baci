import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { checkoutCreditSnapshotStore } from './checkout-credit-snapshot-store';

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

it('derives the generation-scoped snapshot key', () => {
  expect(checkoutCreditSnapshotStore.key(generation)).toBe(
    `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${generation}`
  );
});

it('issues strictly increasing sequences', () => {
  const first = checkoutCreditSnapshotStore.nextSequence();
  const second = checkoutCreditSnapshotStore.nextSequence();
  expect(second).toBeGreaterThan(first);
});

it('returns no record for an unseen generation', () => {
  expect(
    checkoutCreditSnapshotStore.latest('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  ).toBeUndefined();
});

it('keeps only the highest-sequence completed choice', () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  checkoutCreditSnapshotStore.noteCompleted(id, 2, { wallet_amount: 5000 });
  checkoutCreditSnapshotStore.noteCompleted(id, 1, { wallet_amount: 1000 });
  expect(checkoutCreditSnapshotStore.latest(id)).toEqual({
    sequence: 2,
    snapshot: { wallet_amount: 5000 },
  });
  checkoutCreditSnapshotStore.noteCompleted(id, 3, { wallet_amount: 1000 });
  expect(checkoutCreditSnapshotStore.latest(id)).toEqual({
    sequence: 3,
    snapshot: { wallet_amount: 1000 },
  });
});

it('retires the completed choice with a tombstone', () => {
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  checkoutCreditSnapshotStore.noteCompleted(id, 1, { wallet_amount: 5000 });
  checkoutCreditSnapshotStore.noteTombstone(id, 2);
  expect(checkoutCreditSnapshotStore.latest(id)).toEqual({
    sequence: 2,
    tombstone: true,
  });
});
