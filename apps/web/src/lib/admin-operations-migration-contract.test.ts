import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805150200_admin_operations_read_model.sql'
);

describe('admin operations migration contract', () => {
  it('keeps the admin gate, bounded inputs, fixed projection, and no raw payload columns', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("SET statement_timeout = '5s'");
    expect(sql).toContain('private.has_platform_admin_permission_v1');
    expect(sql).toContain("'operations.read'");
    expect(sql).not.toContain('admin_merchant.is_platform_admin');
    expect(sql).toContain('LEAST(COALESCE(p_limit, 25), 100)');
    expect(sql).not.toContain('CREATE INDEX');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_admin_operations_v1(text, integer, integer)\n  TO authenticated;'
    );
    expect(sql).not.toContain('TO authenticated, service_role');
    expect(sql).not.toMatch(
      /esa\.provider_error_message|failure\.failure_message|delivery\.last_error_message|s\.provider_response|swe\.payload|esa\.recipient_email|rr\.metadata|rr\.candidates/i
    );
  });

  it('triages the active wallet payout lane and preserves factual currencies', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('FROM public.payout_requests p');
    expect(sql).not.toContain('FROM public.payouts p');
    expect(sql).toContain('AS currency');
    expect(sql).toContain("'createdAt', created_at, 'currency', currency");
    expect(sql).not.toContain("'currency', 'NGN'");
    expect(sql).toContain("'UNK'::text AS currency");
    expect(sql).toContain("'financials.read'");
    expect(sql).toContain('WHERE v_can_read_financials AND');
  });

  it('does not classify ordinary cancellations or processed webhooks as failures', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).not.toContain("'returned', 'cancelled'");
    expect(sql).not.toContain("IN ('failed', 'rejected', 'cancelled')");
    expect(sql).toContain('WHERE swe.processed IS NOT TRUE');
    expect(sql).toContain('ms.expected_settlement_date < v_now::date');
    expect(sql).toContain("'cancelled', 'direct'");
  });

  it('treats missing processing claim or lock timestamps as stale incidents', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('pse.claimed_at IS NULL');
    expect(sql).toContain('ono.locked_at IS NULL');
    expect(sql).toContain('stno.locked_at IS NULL');
  });
});
