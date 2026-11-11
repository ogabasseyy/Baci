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
    transmission: { reset: jest.fn(), sent: jest.fn().mockReturnValue(true) },
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

it('reports an edit blocked behind a saved request as undone, without recovering', async () => {
  const t = setup();
  t.deps.run.mockRejectedValue(new NativeCartError('pending_operation'));
  t.deps.hasRetainedRequest.mockResolvedValue(true);
  await expect(t.enqueue(add)).rejects.toBeInstanceOf(NativeCartError);
  expect(t.deps.refresh).not.toHaveBeenCalled();
  expect(t.deps.notify.onWriteSucceeded).not.toHaveBeenCalled();
  expect(t.deps.notify.onWriteFailed).toHaveBeenCalledWith(
    add,
    expect.anything(),
    'rolled_back'
  );
});

it('says the edit was not saved when only a lost cart creation was recovered', async () => {
  const t = setup();
  t.deps.transmission.sent.mockReturnValue(false);
  t.deps.run.mockRejectedValue(new NativeCartError('network', true));
  await expect(t.enqueue(add)).rejects.toBeInstanceOf(NativeCartError);
  expect(t.deps.refresh).toHaveBeenCalledTimes(1);
  expect(t.deps.notify.onWriteSucceeded).not.toHaveBeenCalled();
  expect(t.deps.notify.onWriteFailed).toHaveBeenCalledWith(
    add,
    expect.anything(),
    'rolled_back'
  );
});

it('clears the notice after a successful edit that has no screen prediction', async () => {
  const t = setup();
  const assurance = { type: 'assurance', id: 'line-1' } as never;
  await t.enqueue(assurance);
  expect(t.deps.notify.onWriteSucceeded).toHaveBeenCalledTimes(1);
});

it('releases the prediction when the queue refuses the slot before running', async () => {
  const t = setup();
  t.deps.serial = () => Promise.reject(new Error('superseded'));
  const enqueue = createEditQueue(t.deps);
  await expect(enqueue(add)).rejects.toThrow('superseded');
  expect(t.deps.run).not.toHaveBeenCalled();
  expect(t.deps.edits.revert()).toBeNull();
});
