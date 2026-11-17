import { describe, expect, it } from 'vitest';
import { matchesOrFilter } from './postgrest-filter';

describe('matchesOrFilter', () => {
  it('matches when any top-level condition holds', () => {
    expect(matchesOrFilter({ a: 'x', b: 'y' }, 'a.eq.z,b.eq.y')).toBe(true);
    expect(matchesOrFilter({ a: 'x', b: 'y' }, 'a.eq.z,b.eq.z')).toBe(false);
  });

  it('evaluates nested and() and or() groups', () => {
    const filter = 'a.eq.never,and(b.eq.y,or(c.eq.no,c.eq.z))';

    expect(matchesOrFilter({ b: 'y', c: 'z' }, filter)).toBe(true);
    expect(matchesOrFilter({ b: 'y', c: 'q' }, filter)).toBe(false);
    expect(matchesOrFilter({ b: 'n', c: 'z' }, filter)).toBe(false);
  });

  it('does not split lists inside parentheses into separate conditions', () => {
    expect(matchesOrFilter({ s: 'unpaid' }, 's.in.(pending,unpaid)')).toBe(
      true
    );
    expect(matchesOrFilter({ s: 'paid' }, 's.not.in.(pending,unpaid)')).toBe(
      true
    );
    expect(matchesOrFilter({ s: 'pending' }, 's.not.in.(pending,unpaid)')).toBe(
      false
    );
  });

  it('applies SQL NULL rules: a NULL value matches only is.null', () => {
    for (const row of [{ s: null }, {}]) {
      expect(matchesOrFilter(row, 's.is.null')).toBe(true);
      expect(matchesOrFilter(row, 's.not.is.null')).toBe(false);
      expect(matchesOrFilter(row, 's.not.in.(a,b)')).toBe(false);
      expect(matchesOrFilter(row, 's.in.(a,b)')).toBe(false);
      expect(matchesOrFilter(row, 's.eq.a')).toBe(false);
      expect(matchesOrFilter(row, 's.lt.z')).toBe(false);
    }
    expect(matchesOrFilter({ s: 'a' }, 's.not.is.null')).toBe(true);
  });

  it('compares lt lexically, which orders ISO timestamps correctly', () => {
    const filter = 'created_at.lt.2026-06-02T01:30:00.000Z';

    expect(
      matchesOrFilter({ created_at: '2026-06-01T23:00:00.000Z' }, filter)
    ).toBe(true);
    expect(
      matchesOrFilter({ created_at: '2026-06-02T01:30:00.000Z' }, filter)
    ).toBe(false);
  });

  it('rejects predicates it does not support instead of guessing', () => {
    expect(() => matchesOrFilter({ a: 'x' }, 'a.gt.y')).toThrow(
      'unsupported PostgREST condition: a.gt.y'
    );
  });
});
