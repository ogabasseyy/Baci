import {
  createEditQueue,
  isIndeterminateFailure,
} from './controller-edit-queue';
import { NativeCartError } from './native-cart-error';
import { createPendingEdits } from './pending-edits';

function setup(live = true) {
  const shown: unknown[] = [];
  const edits = createPendingEdits((items) => shown.push(items));
  edits.confirm([]);
  const deps = {
    edits,
    live: () => live,
    serial: <T>(run: () => Promise<T>) => run(),
    run: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    hasRetainedRequest: jest.fn().mockResolvedValue(false),
    notify: { onWriteFailed: jest.fn(), onWriteSucceeded: jest.fn() },
  };
  return { deps, enqueue: createEditQueue(deps), shown };
}
const add = {
  type: 'add',
  item: { product_id: 'a', slug: 'a', name: 'a', price: 1, quantity: 1 },
} as const;

it('runs the edit and settles its prediction', async () => {
  const t = setup();
  await t.enqueue(add);
  expect(t.deps.run).toHaveBeenCalledWith(add);
  expect(t.deps.edits.revert()).toBeNull();
});

it('reports a definite rejection as rolled back', async () => {
  const t = setup();
  t.deps.run.mockRejectedValue(new NativeCartError('invalid_item'));
  await expect(t.enqueue(add)).rejects.toBeInstanceOf(NativeCartError);
  expect(t.deps.notify.onWriteFailed).toHaveBeenCalledWith(
    add,
    expect.anything(),
    'rolled_back'
  );
  expect(t.deps.refresh).not.toHaveBeenCalled();
});

it('refreshes and reports unconfirmed when a request is retained', async () => {
  const t = setup();
  t.deps.run.mockRejectedValue(new NativeCartError('rate_limited'));
  t.deps.hasRetainedRequest.mockResolvedValue(true);
  await expect(t.enqueue(add)).rejects.toBeInstanceOf(NativeCartError);
  expect(t.deps.refresh).toHaveBeenCalledTimes(1);
  expect(t.deps.notify.onWriteFailed).toHaveBeenCalledWith(
    add,
    expect.anything(),
    'unconfirmed'
  );
});

it('tells the shopper when the tapped line never landed', async () => {
  const t = setup();
  await t.enqueue({ type: 'remove', id: 'pending-line::99' });
  expect(t.deps.run).not.toHaveBeenCalled();
  expect(t.deps.notify.onWriteFailed).toHaveBeenCalled();
});

it('only treats flagged errors as indeterminate', () => {
  expect(isIndeterminateFailure(new NativeCartError('x', true))).toBe(true);
  expect(
    isIndeterminateFailure(new NativeCartError('temporarily_unavailable'))
  ).toBe(false);
  expect(isIndeterminateFailure(new Error('x'))).toBe(false);
});
