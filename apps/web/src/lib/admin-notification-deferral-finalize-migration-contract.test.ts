import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260817222000_repair_notification_deferral_and_finalize.sql'
  ),
  'utf8'
).toLowerCase();

describe('notification deferral and finalize migration contract', () => {
  it('ignores terminal push outbox rows when selecting quiet-hour candidates', () => {
    expect(sql).toContain(
      'drop function if exists public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])'
    );
    expect(sql).toContain('left join public.admin_notification_push_outbox o');
    expect(sql).toContain("and (o.push_token is null or o.status = 'pending')");
  });

  it('preserves the parent sent transition when no in-app recipient rows exist', () => {
    const sentBranch = sql.slice(sql.indexOf("if p_outcome = 'sent' then"));
    const endSentBranch = sentBranch.indexOf("elsif p_outcome = 'expired'");
    const sentSql = sentBranch.slice(0, endSentBranch);

    expect(sentSql).toContain('get diagnostics v_row_count = row_count');
    expect(
      sentSql.indexOf('get diagnostics v_row_count = row_count')
    ).toBeLessThan(sentSql.indexOf('update public.merchant_notifications'));
    expect(sentSql).not.toMatch(
      /update public\.merchant_notifications[\s\S]*get diagnostics v_row_count = row_count/
    );
  });
});
