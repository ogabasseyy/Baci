import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// GL-A contract: the funding reservation must not read or write the legacy
// in-house wallet, and every release/settle path must skip the legacy hold
// step only when the operation has no legacy wallet transaction.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const names = [
  '20261104130500_piggyvest_goal_funding_release_paths',
  '20261104130600_piggyvest_goal_funding_settle_cancel',
  '20261104130700_piggyvest_goal_funding_settle_complete',
  '20261104130800_piggyvest_goal_funding_reserve',
];
const files = names.map((name) =>
  readFileSync(path.join(root, `supabase/migrations/${name}.sql`), 'utf8')
);
const sql = files.join('\n');

it('splits the change into ordered migrations of at most 300 lines, reserve last', () => {
  for (const file of files) {
    expect(file.split('\n').length).toBeLessThanOrEqual(300);
  }
  const reserveAt = sql.indexOf(
    'CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings_before_interest('
  );
  for (const name of [
    'manage_savings',
    'release_failed_savings',
    'settle_savings_before_completion',
    'settle_goal_cancel',
    'settle_goal_complete',
  ]) {
    const at = sql.indexOf(
      `CREATE OR REPLACE FUNCTION piggyvest_primary.${name}(`
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(reserveAt);
  }
});
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
  // PiggyVest's balance is the authority: no local receipt-ledger balance gate.
  expect(reserve).not.toContain('inflow_receipts');
  expect(reserve).not.toContain('goal_cancel_operations');
  expect(reserve).not.toContain('goal_complete_operations');
  expect(reserve).not.toContain('available_kobo');
  expect(reserve).toContain('capacity_kobo');
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
