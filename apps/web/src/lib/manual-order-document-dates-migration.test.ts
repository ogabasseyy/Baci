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

describe('manual order document date migration', () => {
  it('synchronizes persisted document dates when transaction_date changes', () => {
    expect(migration).toContain(
      'AFTER UPDATE OF transaction_date ON public.orders'
    );
    expect(migration).toContain(
      'OLD.transaction_date AT TIME ZONE v_time_zone'
    );
    expect(migration).toContain(
      'NEW.transaction_date AT TIME ZONE v_time_zone'
    );
    expect(migration).toContain('OLD.transaction_date IS NULL');
    expect(migration).toContain('OLD.created_at AT TIME ZONE');
  });

  it('derives the backfill timezone from merchant country', () => {
    expect(migration).toContain("WHEN 'GH' THEN 'Africa/Accra'");
    expect(migration).toContain("WHEN 'NG' THEN 'Africa/Lagos'");
    expect(migration).toContain("ELSE 'UTC'");
  });
});
