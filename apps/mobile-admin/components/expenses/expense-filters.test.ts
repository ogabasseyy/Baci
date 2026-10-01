import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPENSE_FILTERS,
  getActiveExpenseFilterCount,
  getExpenseFiltersQueryKey,
  normalizeExpenseFilters,
} from './expense-filters';

describe('normalizeExpenseFilters', () => {
  it('uses Lagos-local month boundaries instead of the UTC calendar day', () => {
    const filters = normalizeExpenseFilters(
      DEFAULT_EXPENSE_FILTERS,
      { type: 'all' },
      new Date('2026-07-31T23:30:00.000Z'),
      'Africa/Lagos'
    );

    expect(filters).toMatchObject({
      datePreset: 'this_month',
      endDate: '2026-08-31',
      startDate: '2026-08-01',
    });
  });

  it('uses the device timezone for month boundaries instead of forcing Lagos', () => {
    const filters = normalizeExpenseFilters(
      DEFAULT_EXPENSE_FILTERS,
      { type: 'all' },
      new Date('2026-07-31T23:30:00.000Z'),
      'Africa/Accra'
    );

    expect(filters).toMatchObject({
      endDate: '2026-07-31',
      startDate: '2026-07-01',
    });
  });

  it('normalizes a reversed custom date range without storing Date objects', () => {
    const filters = normalizeExpenseFilters(
      {
        ...DEFAULT_EXPENSE_FILTERS,
        datePreset: 'custom',
        endDate: '2026-08-03',
        startDate: '2026-08-09',
      },
      { type: 'all' },
      new Date('2026-08-09T12:00:00.000Z')
    );

    expect(filters).toMatchObject({
      datePreset: 'custom',
      endDate: '2026-08-09',
      startDate: '2026-08-03',
    });
    expect(JSON.stringify(filters)).not.toContain('T12:00:00.000Z');
  });

  it('clears impossible custom date-only values without changing a valid bound', () => {
    const filters = normalizeExpenseFilters(
      {
        ...DEFAULT_EXPENSE_FILTERS,
        datePreset: 'custom',
        endDate: '2026-03-01',
        startDate: '2026-02-31',
      },
      { type: 'all' }
    );

    expect(filters).toMatchObject({
      datePreset: 'custom',
      endDate: '2026-03-01',
      startDate: null,
    });
  });

  it('clears an impossible custom end date instead of treating its text as a range boundary', () => {
    const filters = normalizeExpenseFilters(
      {
        ...DEFAULT_EXPENSE_FILTERS,
        datePreset: 'custom',
        endDate: '2026-02-31',
        startDate: '2026-03-01',
      },
      { type: 'all' }
    );

    expect(filters).toMatchObject({
      datePreset: 'custom',
      endDate: null,
      startDate: '2026-03-01',
    });
  });

  it('uses the locked branch scope over a conflicting branch filter', () => {
    const filters = normalizeExpenseFilters(
      { ...DEFAULT_EXPENSE_FILTERS, branchId: 'branch-from-sheet' },
      { type: 'branch', branchId: 'branch-from-scope' }
    );

    expect(filters.branchId).toBe('branch-from-scope');
  });

  it('keeps unscoped branch filters in state while applying branch scope only at query time', () => {
    const stored = { ...DEFAULT_EXPENSE_FILTERS, branchId: 'all' };
    const scoped = normalizeExpenseFilters(stored, {
      type: 'branch',
      branchId: 'branch-from-scope',
    });

    expect(stored.branchId).toBe('all');
    expect(scoped.branchId).toBe('branch-from-scope');
  });

  it('does not count the branch-owned scope as an active filter', () => {
    expect(
      getActiveExpenseFilterCount(
        { ...DEFAULT_EXPENSE_FILTERS, branchId: 'branch-from-scope' },
        { type: 'branch', branchId: 'branch-from-scope' }
      )
    ).toBe(0);
  });
});

describe('expense filter state', () => {
  it('counts each changed filter dimension and resets to defaults', () => {
    expect(getActiveExpenseFilterCount(DEFAULT_EXPENSE_FILTERS)).toBe(0);
    expect(
      getActiveExpenseFilterCount({
        datePreset: 'last_month',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        category: 'Travel',
        branchId: 'branch-1',
        groupId: 'ungrouped',
      })
    ).toBe(4);
    expect(DEFAULT_EXPENSE_FILTERS).toEqual({
      datePreset: 'this_month',
      startDate: null,
      endDate: null,
      category: 'all',
      branchId: 'all',
      groupId: 'all',
    });
  });

  it('builds a serializable query key with normalized date-only values', () => {
    const filters = normalizeExpenseFilters(
      { ...DEFAULT_EXPENSE_FILTERS, datePreset: 'last_month' },
      { type: 'all' },
      new Date('2026-08-11T12:00:00.000Z')
    );

    expect(getExpenseFiltersQueryKey('merchant-1', filters)).toEqual([
      'expenses',
      'merchant-1',
      {
        branchId: 'all',
        category: 'all',
        datePreset: 'last_month',
        endDate: '2026-07-31',
        groupId: 'all',
        startDate: '2026-07-01',
      },
    ]);
    expect(
      Object.values(getExpenseFiltersQueryKey('merchant-1', filters)[2]).some(
        (value) => value instanceof Date
      )
    ).toBe(false);
  });
});
