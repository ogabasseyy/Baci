import { describe, expect, it } from 'vitest';
import { compareReceiptListDesc } from './receipt-sort';

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

  it('falls back to the transaction date and then the creation date', () => {
    const byTransaction = {
      created_at: '2026-03-05T10:00:00.000Z',
      transaction_date: '2026-04-02T10:00:00.000Z',
      invoice_issue_date: null,
    };
    const byCreation = { created_at: '2026-03-20T10:00:00.000Z' };

    expect([byCreation, byTransaction].sort(compareReceiptListDesc)).toEqual([
      byTransaction,
      byCreation,
    ]);
    expect(compareReceiptListDesc(byCreation, {})).toBeLessThan(0);
  });

  it('sorts orders without a parseable date last', () => {
    const dated = { created_at: '2026-03-05T10:00:00.000Z' };
    const missing = {};
    const invalid = { invoice_issue_date: 'not-a-date' };

    expect([missing, dated, invalid].sort(compareReceiptListDesc)[0]).toEqual(
      dated
    );
    expect(compareReceiptListDesc(missing, invalid)).toBe(0);
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
