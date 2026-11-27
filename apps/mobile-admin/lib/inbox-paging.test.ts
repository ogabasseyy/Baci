import { describe, expect, it } from 'vitest';
import { inboxRefetchInterval, MAX_AUTO_PAGES } from './inbox-paging';

describe('inboxRefetchInterval', () => {
  it('stays on 30 seconds up to the two pages of a one-page store', () => {
    expect([0, 1, 2].map(inboxRefetchInterval)).toEqual([
      30_000, 30_000, 30_000,
    ]);
  });

  it('waits longer as a refresh has more pages to ask for', () => {
    expect(inboxRefetchInterval(3)).toBe(60_000);
    expect(inboxRefetchInterval(MAX_AUTO_PAGES)).toBe(120_000);
  });
});
