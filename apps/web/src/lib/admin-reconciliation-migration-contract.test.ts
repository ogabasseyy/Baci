import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260805150100_admin_reconciliation_read_model.sql'
);
const exportAuditMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260805150600_admin_reconciliation_export_audit.sql'
);
const currencyTruthMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151510_repair_admin_reconciliation_currency_truth.sql'
);
const itemTruthMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151513_withhold_currencyless_reconciliation_items.sql'
);

describe('admin reconciliation migration contract', () => {
  it('keeps the read model admin-gated, redacted, and separate from legacy payouts', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("SET statement_timeout = '8s'");
    expect(sql).toContain("'financials.read'");
    expect(sql).toContain('private.has_platform_admin_permission_v1');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_admin_reconciliation'
    );
    expect(sql).toContain('TO authenticated');
    expect(sql).not.toMatch(/FROM public\.payouts\b/);
    expect(sql).not.toContain('bank_account_number');
    expect(sql).not.toContain('gateway_response');
    expect(sql).not.toContain('metadata');
    expect(sql).not.toContain('customer_email');
  });

  it('uses bounded keyset pagination and current payout requests', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain(
      'v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)'
    );
    expect(sql).toContain('e.occurred_at < p_cursor_created_at');
    expect(sql).toContain('e.id < p_cursor_id');
    expect(sql).toContain('COALESCE(ms.created_at, v_platform_start)');
    expect(sql).toContain('COALESCE(pr.created_at, v_platform_start)');
    expect(sql).toContain('COALESCE(t.created_at, v_platform_start)');
    expect(sql).toContain('COALESCE(rr.created_at, v_platform_start)');
    expect(sql).toContain("'currency', pe.currency");
    expect(sql).toContain("'supportedCurrencies'");
    expect(sql).toContain('FROM public.payout_requests pr');
    expect(sql).toContain('FROM public.merchant_wallets mw');
    expect(sql).toContain("'UNK'::text AS currency");
    expect(sql).toContain(
      "t.transaction_type = 'payment' AND t.status IN ('refunded', 'refund_pending')"
    );
    expect(sql).toContain(
      "LOWER(BTRIM(COALESCE(o.payment_status, ''))) = 'paid'"
    );
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it('uses a fixed financials.read audit command for exports', async () => {
    const sql = await readFile(exportAuditMigrationPath, 'utf8');

    expect(sql).toContain(
      'FUNCTION public.write_admin_reconciliation_export_event_v1()'
    );
    expect(sql).toContain("'financials.read'");
    expect(sql).toContain("'reconciliation.exported'");
    expect(sql).toContain("'financial_reconciliation'");
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("SET statement_timeout = '5s'");
    expect(sql).not.toContain('p_action');
    expect(sql).not.toContain('p_metadata');
  });

  it('withholds currency-less settlement amounts and names the review scope', async () => {
    const sql = await readFile(currencyTruthMigrationPath, 'utf8');

    expect(sql).toContain('FUNCTION public.get_admin_reconciliation_v2');
    expect(sql).toContain("IF p_currency = 'UNK' THEN");
    expect(sql).toContain("WHERE currency.value <> 'UNK'");
    expect(sql).toContain(
      "'{metrics,platformSettlements,pendingAmount}', 'null'::jsonb"
    );
    expect(sql).toContain(
      "'{metrics,directSettlements,amount}', 'null'::jsonb"
    );
    expect(sql).toContain("'reviewScope', 'all_unresolved'");
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
  });

  it('removes settlement money from every activity item before it reaches the API', async () => {
    const sql = await readFile(itemTruthMigrationPath, 'utf8');

    expect(sql).toContain('FUNCTION public.get_admin_reconciliation_v3');
    expect(sql).toContain("IN ('platform_settlement', 'direct_settlement')");
    expect(sql).toContain("'{amount}', 'null'::jsonb");
    expect(sql).toContain("'{currency}', 'null'::jsonb");
    expect(sql).toContain('public.get_admin_reconciliation_v2');
    expect(sql).toContain('SECURITY DEFINER');
  });
});
