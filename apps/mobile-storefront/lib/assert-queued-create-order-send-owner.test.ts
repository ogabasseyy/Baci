import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import { assertQueuedCreateOrderSendOwner } from './assert-queued-create-order-send-owner';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

it('allows live checkout when no queued owner is expected', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(undefined, [accountB])
  ).not.toThrow();
});

it('rejects an in-flight account transition at the send boundary', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(accountA, [accountA, accountB])
  ).toThrow(DeferredOfflineMutationError);
});

it('rejects an authenticated queue after the session is cleared', () => {
  expect(() => assertQueuedCreateOrderSendOwner(accountA, [undefined])).toThrow(
    DeferredOfflineMutationError
  );
});
