import { describe, expect, it } from 'vitest';
import {
  compareReceiptListDesc,
  selectReceiptSortTimestamp,
} from './receipt-sort';

describe('selectReceiptSortTimestamp', () => {
  it('prefers the invoice issue date over the transaction date', () => {
    expect(
      selectReceiptSortTimestamp({
        created_at: '2026-03-05T10:00:00.000Z',
        transaction_date: '2026-03-05T10:00:00.000Z',
        invoice_issue_date: '2026-09-12',
      })
    ).toBe(Date.parse('2026-09-12T12:00:00.000Z'));
  });

  it('falls back to the transaction date and then the creation date', () => {
    expect(
      selectReceiptSortTimestamp({
        created_at: '2026-03-05T10:00:00.000Z',
        transaction_date: '2026-04-02T10:00:00.000Z',
        invoice_issue_date: null,
      })
    ).toBe(Date.parse('2026-04-02T10:00:00.000Z'));
    expect(
      selectReceiptSortTimestamp({
        created_at: '2026-03-05T10:00:00.000Z',
      })
    ).toBe(Date.parse('2026-03-05T10:00:00.000Z'));
  });

  it('sorts orders without a parseable date last', () => {
    expect(selectReceiptSortTimestamp({})).toBe(Number.NEGATIVE_INFINITY);
    expect(
      selectReceiptSortTimestamp({ invoice_issue_date: 'not-a-date' })
    ).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('compareReceiptListDesc', () => {
  it('files a backdated invoice by its issue date, not its transaction date', () => {
    const backdated = {
      invoice_issue_date: '2026-09-12',
      transaction_date: '2026-03-05T10:00:00.000Z',
      created_at: '2026-03-05T10:00:00.000Z',
    };
    const april = {
      transaction_date: '2026-04-02T10:00:00.000Z',
      created_at: '2026-04-02T10:00:00.000Z',
    };

    expect([april, backdated].sort(compareReceiptListDesc)).toEqual([
      backdated,
      april,
    ]);
  });

  it('keeps date-only values on their calendar day in every timezone', () => {
    // A naive local-midnight parse would file 5 March below a late 4 March
    // timestamp for viewers east of UTC; the UTC-noon anchor keeps the day.
    const dateOnly = { invoice_issue_date: '2026-03-05' };
    const latePriorDay = { transaction_date: '2026-03-04T23:30:00.000Z' };

    expect([latePriorDay, dateOnly].sort(compareReceiptListDesc)).toEqual([
      dateOnly,
      latePriorDay,
    ]);
  });
});
