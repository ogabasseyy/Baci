import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// GL-A contract: the funding reservation must not read or write the legacy
// in-house wallet, and every release/settle path must skip the legacy hold
// step only when the operation has no legacy wallet transaction.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const sql = readFileSync(
  path.join(
    root,
    'supabase/migrations/20261104130500_piggyvest_goal_funding_primary_balance.sql'
  ),
  'utf8'
);
function body(name: string) {
  const start = sql.indexOf(
    `CREATE OR REPLACE FUNCTION piggyvest_primary.${name}(`
  );
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('END $$;', start);
  return sql.slice(start, end);
}

it('reserves without touching customer_wallets or wallet transactions', () => {
  const reserve = body('reserve_savings_before_interest');
  expect(reserve).not.toContain('customer_wallets');
  expect(reserve).not.toContain('customer_wallet_transactions');
  expect(reserve).not.toContain('wallet_transaction_id');
  expect(reserve).toContain('inflow_receipts');
  expect(reserve).toContain(
    "RETURN jsonb_build_object('status','insufficient')"
  );
});

it.each([
  'manage_savings',
  'release_failed_savings',
  'settle_savings_before_completion',
])('%s skips the legacy hold only when there is none', (name) => {
  const fn = body(name);
  expect(fn).toContain('IF operation.wallet_transaction_id IS NOT NULL THEN');
  expect(fn).toContain('savings hold unavailable');
});

it('does not trust a caller-supplied balance', () => {
  expect(body('reserve_savings_before_interest')).not.toMatch(
    /request->>'(balance|availableKobo|walletBalance)'/
  );
});

function settleBody(name: string) {
  const start = sql.indexOf(
    `CREATE OR REPLACE FUNCTION piggyvest_primary.${name}(`
  );
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('END;\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

it.each([
  'settle_goal_cancel',
  'settle_goal_complete',
])('%s never credits the legacy wallet', (name) => {
  const fn = settleBody(name);
  expect(fn).not.toContain('customer_wallets');
  expect(fn).not.toContain('customer_wallet_transactions');
  expect(fn).toContain("RETURN 'conflict'");
});

it('keeps the goal complete purchase request in the settlement', () => {
  expect(settleBody('settle_goal_complete')).toContain(
    'INSERT INTO piggyvest_primary.goal_purchase_requests'
  );
});
