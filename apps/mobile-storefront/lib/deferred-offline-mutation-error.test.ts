import { DeferredOfflineMutationError } from './deferred-offline-mutation-error';

it('keeps deferred queue failures distinguishable from ordinary errors', () => {
  const error = new DeferredOfflineMutationError(
    'Queued checkout belongs to a different account'
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(DeferredOfflineMutationError);
  expect(error.name).toBe('DeferredOfflineMutationError');
  expect(error.message).toBe('Queued checkout belongs to a different account');
});
