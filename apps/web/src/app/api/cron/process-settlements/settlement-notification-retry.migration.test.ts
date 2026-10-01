import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../../../supabase/migrations/20260928183300_settlement_notification_retry_backoff.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('settlement notification retry migration', () => {
  it('adds retry scheduling columns and the queue index idempotently', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'ADD COLUMN IF NOT EXISTS notification_attempts integer NOT NULL DEFAULT 0'
    );
    expect(migrationSql).toContain(
      'ADD COLUMN IF NOT EXISTS notification_next_retry_at timestamptz'
    );
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS merchant_settlements_notification_queue_idx'
    );
    // Capped rows never match the queue query: excluding them keeps
    // the partial index small as dead letters accumulate. The cap
    // mirrors SETTLEMENT_NOTIFICATION_MAX_ATTEMPTS.
    expect(migrationSql).toContain(
      "WHERE status = 'settled' AND settlement_notified = false AND notification_attempts < 5"
    );
  });

  it('stays within the migration line limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const lines = readFileSync(migrationPath, 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(300);
  });
});
