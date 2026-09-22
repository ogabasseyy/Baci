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

it('reports the frozen choice actually submitted', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  expect(checkoutCreditSnapshotStore.completedChoice(id)).toBeUndefined();
  checkoutCreditSnapshotStore.noteCompleted(id, 1, { wallet_amount: 5000 });
  expect(checkoutCreditSnapshotStore.completedChoice(id)).toEqual({
    wallet_amount: 5000,
  });
  checkoutCreditSnapshotStore.noteTombstone(id, 2);
  expect(checkoutCreditSnapshotStore.completedChoice(id)).toBeUndefined();
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

it('serializes operations sharing a generation', async () => {
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const order: string[] = [];
  const first = checkoutCreditSnapshotStore.enqueue(id, async () => {
    order.push('first');
  });
  const second = checkoutCreditSnapshotStore.enqueue(id, async () => {
    order.push('second');
  });
  await Promise.all([first, second]);
  expect(order).toEqual(['first', 'second']);
});

it('resets only the specified generation queue', async () => {
  const resetId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const keptId = '11111111-1111-4111-8111-111111111111';
  let releaseKept!: () => void;
  let enteredKept!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    enteredKept = resolve;
  });
  const first = checkoutCreditSnapshotStore.enqueue(
    keptId,
    () =>
      new Promise<void>((release) => {
        releaseKept = release;
        enteredKept();
      })
  );
  await enteredPromise;
  checkoutCreditSnapshotStore.resetKey(resetId);
  let secondRan = false;
  const second = checkoutCreditSnapshotStore.enqueue(keptId, async () => {
    secondRan = true;
  });
  // The kept generation stays serialized: the second op cannot run while
  // the first is still gated, even after an unrelated reset.
  await Promise.resolve();
  await Promise.resolve();
  expect(secondRan).toBe(false);
  releaseKept();
  await Promise.all([first, second]);
  expect(secondRan).toBe(true);
});
