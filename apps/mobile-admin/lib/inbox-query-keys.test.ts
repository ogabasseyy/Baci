import { partialMatchKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  inboxConversationsKey,
  inboxSearchKey,
  inboxSearchPrefix,
  inboxThreadKey,
  inboxViewKey,
} from './inbox-query-keys';

/** True when invalidating `prefix` would also refresh a query keyed `key`. */
const refreshes = (
  prefix: readonly unknown[],
  key: readonly unknown[]
): boolean => partialMatchKey(key, prefix);

describe('inbox query keys', () => {
  it('builds each key from its merchant, view, term or chat', () => {
    expect(inboxConversationsKey('m1')).toEqual(['inbox-conversations', 'm1']);
    expect(inboxViewKey('m1', 'done')).toEqual([
      'inbox-conversations',
      'm1',
      'done',
    ]);
    expect(inboxSearchPrefix('m1')).toEqual(['inbox-search', 'm1']);
    expect(inboxSearchKey('m1', 'order')).toEqual([
      'inbox-search',
      'm1',
      'order',
    ]);
    expect(inboxThreadKey('m1', 9)).toEqual(['inbox-thread', 'm1', 9]);
  });

  it('refreshing the list prefix refreshes every view of that merchant', () => {
    const prefix = inboxConversationsKey('m1');
    for (const view of ['needs_reply', 'unread', 'follow_up', 'done', 'all']) {
      expect(refreshes(prefix, inboxViewKey('m1', view))).toBe(true);
    }
  });

  it('never refreshes another merchant, or a different kind of query', () => {
    const prefix = inboxConversationsKey('m1');
    expect(refreshes(prefix, inboxViewKey('m2', 'done'))).toBe(false);
    expect(refreshes(prefix, inboxSearchKey('m1', 'order'))).toBe(false);
    expect(refreshes(prefix, inboxThreadKey('m1', 9))).toBe(false);
  });

  it('refreshing the search prefix refreshes every term of that merchant only', () => {
    const prefix = inboxSearchPrefix('m1');
    expect(refreshes(prefix, inboxSearchKey('m1', 'order'))).toBe(true);
    expect(refreshes(prefix, inboxSearchKey('m1', 'ada'))).toBe(true);
    expect(refreshes(prefix, inboxSearchKey('m2', 'order'))).toBe(false);
    expect(refreshes(prefix, inboxViewKey('m1', 'done'))).toBe(false);
  });

  it('keeps one search cache entry per term', () => {
    expect(inboxSearchKey('m1', 'order')).not.toEqual(
      inboxSearchKey('m1', 'orders')
    );
  });

  it('keeps one thread cache entry per merchant and chat', () => {
    expect(inboxThreadKey('m1', 9)).not.toEqual(inboxThreadKey('m1', 10));
    expect(inboxThreadKey('m1', 9)).not.toEqual(inboxThreadKey('m2', 9));
  });

  it('handles a merchant that is not known yet without matching a real one', () => {
    expect(inboxConversationsKey(undefined)).toEqual([
      'inbox-conversations',
      undefined,
    ]);
    expect(
      refreshes(inboxConversationsKey(undefined), inboxViewKey('m1', 'done'))
    ).toBe(false);
    expect(
      refreshes(inboxSearchPrefix(undefined), inboxSearchKey('m1', 'a'))
    ).toBe(false);
  });
});
