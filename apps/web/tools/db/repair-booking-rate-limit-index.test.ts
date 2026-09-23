import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const INDEX_MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'supabase/migrations/20260921100100_add_repair_booking_rate_limit_index.sql'
);

describe('repair booking rate-limit index migration', () => {
  it('adds a concurrent normalized-email index for the public booking limiter', () => {
    expect(existsSync(INDEX_MIGRATION_PATH)).toBe(true);
    if (!existsSync(INDEX_MIGRATION_PATH)) {
      return;
    }

    const migration = readFileSync(INDEX_MIGRATION_PATH, 'utf8');
    expect(migration).toContain('-- disable-transaction');
    expect(migration).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS repairs_merchant_normalized_email_created_at_idx\s+ON public\.repairs \(merchant_id, lower\(btrim\(customer_email\)\), created_at\);/
    );
  });

  it('recovers an invalid concurrent index before retrying its build', () => {
    expect(existsSync(INDEX_MIGRATION_PATH)).toBe(true);
    if (!existsSync(INDEX_MIGRATION_PATH)) {
      return;
    }

    const migration = readFileSync(INDEX_MIGRATION_PATH, 'utf8');
    expect(migration).toContain('-- disable-transaction');
    expect(migration).toContain("index_namespace.nspname = 'public'");
    expect(migration).toContain(
      "index_class.relname = 'repairs_merchant_normalized_email_created_at_idx'"
    );
    expect(migration).toContain('AND NOT index_state.indisvalid');
    expect(migration).toContain(
      'DROP INDEX IF EXISTS public.repairs_merchant_normalized_email_created_at_idx;'
    );
    expect(migration).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS repairs_merchant_normalized_email_created_at_idx\s+ON public\.repairs \(merchant_id, lower\(btrim\(customer_email\)\), created_at\);/
    );
  });
});
