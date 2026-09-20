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
// workflow (including supabase/migrations/tests/manual_order_document_date_sync.sql);
// this colocated Vitest suite has no database fixture or connection.

const reviewSyncMigration = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../../supabase/migrations/20260920160000_sync_review_transaction_date_to_document_dates.sql'
  ),
  'utf8'
);

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

  it('initializes provenance for NULL-dated rows before the backfill', () => {
    expect(migration).toContain('invoice_issue_date IS NULL THEN true');
    expect(migration).toContain('tax_point_date IS NULL THEN true');
    // Historical manual rows carry system-stamped recording-day dates (the
    // released app never sent document dates), so manual origins join the
    // generated set; other explicit dates stay untouched. Each flag
    // initializes only from NULL so replays preserve explicit FALSE values.
    expect(migration).toContain('invoice_issue_date_generated IS NULL');
    expect(migration).toContain('tax_point_date_generated IS NULL');
    expect(migration).toContain(
      "AND (source IN ('manual', 'staff_entry', 'physical'"
    );
    // Proven-import rows (import job/external source markers) join the
    // generated set too: their dates were stamped as the import day.
    expect(migration).toContain('OR import_job_id IS NOT NULL');
    expect(migration).toContain('OR external_source IS NOT NULL');
    // The init must run first: without it the backfill WHERE clause (IS TRUE
    // over NULL-for-all-rows columns) would update no pre-existing orders.
    expect(
      migration.indexOf(
        'WHERE invoice_issue_date IS NULL OR tax_point_date IS NULL'
      )
    ).toBeLessThan(
      migration.indexOf(
        '(invoice_issue_date_generated IS TRUE OR tax_point_date_generated IS TRUE)'
      )
    );
  });

  it('clears provenance flags when explicit dates arrive with a transaction change', () => {
    expect(migration).toContain(
      'NEW.invoice_issue_date IS DISTINCT FROM OLD.invoice_issue_date'
    );
    expect(migration).toContain(
      'NEW.tax_point_date IS DISTINCT FROM OLD.tax_point_date'
    );
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

describe('review transaction date sync migration', () => {
  it('moves both document dates to the reviewer day on transaction edits', () => {
    expect(reviewSyncMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.update_transaction_review_details('
    );
    expect(reviewSyncMigration).toContain(
      '(p_transaction_date AT TIME ZONE v_transaction_time_zone)::date'
    );
  });

  it('compares calendar days so cost-only edits preserve the date block', () => {
    // The editor re-serializes the field as reviewer-local midnight on every
    // save, so instant comparison would clobber dates on cost-only edits.
    expect(reviewSyncMigration).toContain(
      'transaction_date AT TIME ZONE v_transaction_time_zone'
    );
    expect(reviewSyncMigration).toContain('WHEN v_day_changed THEN false');
    expect(reviewSyncMigration).toContain('ELSE transaction_date');
    expect(reviewSyncMigration).toContain('ELSE invoice_issue_date_generated');
    expect(reviewSyncMigration).toContain('ELSE tax_point_date_generated');
  });
});
