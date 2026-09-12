import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../../supabase/migrations/20260912150000_backfill_manual_order_document_dates.sql'
  ),
  'utf8'
);

// PostgreSQL behavioral checks run through the repository's Docker replay
// workflow; this colocated Vitest suite has no database fixture or connection.

describe('manual order document date migration', () => {
  it('synchronizes persisted document dates when transaction_date changes', () => {
    expect(migration).toContain(
      'AFTER UPDATE OF transaction_date ON public.orders'
    );
    expect(migration).toContain(
      'NEW.transaction_date AT TIME ZONE v_time_zone'
    );
    expect(migration).toContain('invoice_issue_date_generated IS TRUE');
    expect(migration).toContain('tax_point_date_generated IS TRUE');
  });

  it('derives the backfill timezone from merchant country', () => {
    expect(migration).toContain("WHEN 'GH' THEN 'Africa/Accra'");
    expect(migration).toContain("WHEN 'NG' THEN 'Africa/Lagos'");
    expect(migration).toContain('ELSE NULL');
  });

  it('preserves explicit dates while updating generated dates independently', () => {
    expect(migration).toContain(
      'invoice_issue_date = CASE\n    WHEN invoice_issue_date_generated IS TRUE'
    );
    expect(migration).toContain(
      'tax_point_date = CASE\n    WHEN tax_point_date_generated IS TRUE'
    );
    expect(migration).toContain(
      '(invoice_issue_date_generated IS TRUE OR tax_point_date_generated IS TRUE)'
    );
  });
});
