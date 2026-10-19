import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260815193000_repair_notification_codex_review_followups.sql'
  ),
  'utf8'
).toLowerCase();

describe('notification codex review followups migration contract', () => {
  it('clears recipient visibility when every visible channel is disabled on retry', () => {
    expect(sql).toContain('update public.merchant_notifications as existing');
    expect(sql).toContain('in_app_visible = false');
    expect(sql).toContain('banner_visible = false');
    expect(sql).toContain('and not (');
  });

  it('recovers stale dispatching push rows before selecting quiet-hour candidates', () => {
    expect(sql).toContain(
      'drop function if exists public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])'
    );
    expect(sql).toContain("outbox.status = 'dispatching'");
    expect(sql).toContain("set status = 'pending'");
    expect(sql).toContain(
      "outbox.dispatched_at < statement_timestamp() - interval '15 minutes'"
    );
    expect(sql).toContain('outbox.claim_token is distinct from p_claim_token');
  });
});
