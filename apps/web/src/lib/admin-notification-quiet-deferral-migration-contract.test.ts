import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811130001_repair_notification_detail_quiet_deferrals.sql'
  ),
  'utf8'
);

describe('notification detail and quiet-deferral migration contract', () => {
  it('preserves lifecycle fields in notification details', () => {
    expect(sql).toContain("'delivery_state',n.delivery_state");
    expect(sql).toContain("'delivery_attempts',n.delivery_attempts");
    expect(sql).toContain("'delivery_last_error',n.delivery_last_error");
  });

  it('does not treat quiet-hour deferred rows as pending failures', () => {
    expect(sql).toContain(
      "status = 'pending' AND error_code IS DISTINCT FROM 'quiet_hours_deferred'"
    );
    expect(sql).toContain("'quiet_hours_deferred'");
  });
});
