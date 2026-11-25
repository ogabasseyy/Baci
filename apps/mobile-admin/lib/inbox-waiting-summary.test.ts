import { describe, expect, it } from 'vitest';
import { inboxWaitingSummary } from './inbox-waiting-summary';

describe('inboxWaitingSummary', () => {
  it('says nothing when no chat is waiting', () => {
    expect(inboxWaitingSummary(0, true)).toBeNull();
  });

  it('gives the exact count once every page is loaded', () => {
    expect(inboxWaitingSummary(1, false)).toBe(
      '1 chat is waiting for your reply'
    );
    expect(inboxWaitingSummary(3, false)).toBe(
      '3 chats are waiting for your reply'
    );
  });

  it('claims only a lower bound while more pages are behind', () => {
    expect(inboxWaitingSummary(1, true)).toBe(
      'At least 1 chat is waiting for your reply'
    );
    expect(inboxWaitingSummary(3, true)).toBe(
      'At least 3 chats are waiting for your reply'
    );
  });
});
