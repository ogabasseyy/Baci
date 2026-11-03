import { describe, expect, it } from 'vitest';
import {
  position,
  REPOST_QUESTIONS,
  TRIVIALLY_DIFFERENT,
  walletIdsOf,
} from './proof-1-support';

describe('position', () => {
  it('names where a wallet sits in an ordered list', () => {
    expect(position(['a', 'b', 'c'], 'a')).toBe('first_of_3');
    expect(position(['a', 'b', 'c'], 'b')).toBe('middle_of_3');
    expect(position(['a', 'b', 'c'], 'c')).toBe('last_of_3');
    expect(position(['a'], 'a')).toBe('only');
  });
  it('is null when the wallet is absent or no target is known', () => {
    expect(position(['a', 'b'], 'z')).toBeNull();
    expect(position(['a', 'b'], null)).toBeNull();
    expect(position([], 'a')).toBeNull();
  });
});

describe('walletIdsOf', () => {
  it('lists the ids of the edges that have one, keeping every edge', () => {
    const edges = [{ id: 'a' }, { name: 'no id' }, { id: 'b' }];
    expect(walletIdsOf({ edges })).toEqual({ edges, ids: ['a', 'b'] });
  });
  it('is empty for a missing list, never throwing', () => {
    expect(walletIdsOf(null)).toEqual({ edges: [], ids: [] });
  });
});

describe('constants', () => {
  it('never treats identity-by-definition fields as distinguishing the default wallet', () => {
    for (const field of ['id', 'created_at', 'virtual_account_id', 'balance']) {
      expect(TRIVIALLY_DIFFERENT.has(field)).toBe(true);
    }
    expect(TRIVIALLY_DIFFERENT.has('name')).toBe(false);
  });
  it('lists each re-POST question once, with a stable id', () => {
    const ids = REPOST_QUESTIONS.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('repost_returns_same_wallet_id');
  });
});
