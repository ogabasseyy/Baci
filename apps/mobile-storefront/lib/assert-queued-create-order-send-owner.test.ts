import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import {
  assertQueuedCreateOrderSendOwner,
  QUEUED_CREATE_ORDER_SESSION_TIMEOUT_MESSAGE,
} from './assert-queued-create-order-send-owner';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

it('allows live checkout when no queued owner is expected', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(undefined, {
      resolvedUserIds: [accountB],
    })
  ).not.toThrow();
});

it('rejects an in-flight account transition at the send boundary', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(accountA, {
      resolvedUserIds: [accountA],
      storageUserId: accountB,
    })
  ).toThrow(DeferredOfflineMutationError);
});

it('rejects an authenticated queue after the session is cleared', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(accountA, {
      resolvedUserIds: [],
      storageUserId: undefined,
    })
  ).toThrow(DeferredOfflineMutationError);
});

it('does not defer forever when the final storage read times out after owner A resolved', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(accountA, {
      resolvedUserIds: [accountA, accountA],
      storageReadInconclusive: true,
    })
  ).not.toThrow();
});

it('retries when the send-boundary session read times out with no resolved owner', () => {
  expect(() =>
    assertQueuedCreateOrderSendOwner(accountA, {
      resolvedUserIds: [undefined, undefined],
      storageReadInconclusive: true,
    })
  ).toThrow(QUEUED_CREATE_ORDER_SESSION_TIMEOUT_MESSAGE);
  try {
    assertQueuedCreateOrderSendOwner(accountA, {
      resolvedUserIds: [undefined, undefined],
      storageReadInconclusive: true,
    });
  } catch (error) {
    expect(error).not.toBeInstanceOf(DeferredOfflineMutationError);
  }
});
