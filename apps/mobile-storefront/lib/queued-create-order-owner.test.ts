import { queuedCreateOrderOwnerMismatch } from './queued-create-order-owner';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('bugfix: queued orders stay bound to the originating account', () => {
  it('refuses replay when two authenticated account IDs differ', () => {
    expect(queuedCreateOrderOwnerMismatch(accountA, accountB)).toBe(true);
  });

  it('refuses replay when the authenticated owner is signed out', () => {
    expect(queuedCreateOrderOwnerMismatch(accountA, undefined)).toBe(true);
  });

  it('allows guest queues and same-account replay', () => {
    expect(queuedCreateOrderOwnerMismatch('guest', accountA)).toBe(false);
    expect(queuedCreateOrderOwnerMismatch(accountA, accountA)).toBe(false);
    expect(queuedCreateOrderOwnerMismatch('', undefined)).toBe(false);
  });
});
