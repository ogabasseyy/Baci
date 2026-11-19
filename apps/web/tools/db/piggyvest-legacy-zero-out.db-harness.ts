import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  C1,
  C2,
  docsDir,
  M,
  type Scratch,
  W1,
} from './piggyvest-legacy-runbook.db-support';

export const zeroSql = readFileSync(join(docsDir, '02-zero-out.sql'), 'utf8');

export const row = (w: string, c: string, amt: string, ref = `PV-REF-${amt}`) =>
  `('${w}','${M}','${c}',${amt},'${ref}')`;
const load = (rows: string[], declared: number | number[]) =>
  `INSERT INTO legacy_zero_out_declared (expected_rows) VALUES ${[declared]
    .flat()
    .map((d) => `(${d})`)
    .join(',')};\n` +
  (rows.length === 0
    ? ''
    : `INSERT INTO legacy_zero_out_list (wallet_id, merchant_id, customer_id, expected_balance, piggyvest_credit_reference) VALUES\n${rows.join(',\n')};`);

// Shared fixtures for the zero-out script tests; `get` returns the live scratch.
export const makeHarness = (get: () => Scratch) => {
  const s = new Proxy({} as Scratch, {
    get: (_t, k) => (get() as unknown as Record<string | symbol, unknown>)[k],
  });
  // Seeds each wallet with the given balance AND a completed credit ledger row
  // of the same amount, so stored balance and ledger agree.
  const reset = (balances: [string, string][], extra = '') =>
    s.psql(
      `DELETE FROM customer_wallet_transactions; DELETE FROM customer_wallets; DELETE FROM customers;
       INSERT INTO customers (id, merchant_id, full_name) VALUES ('${C1}','${M}','One'),('${C2}','${M}','Two');
       ${balances
         .map(([w, b]) => {
           const c = w === W1 ? C1 : C2;
           return `INSERT INTO customer_wallets (id, customer_id, merchant_id, available_balance, updated_at) VALUES ('${w}','${c}','${M}',${b},'2020-01-01T00:00:00Z');
             INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status) VALUES ('${w}','${c}','${M}','credit',${b},${b},'completed');`;
         })
         .join('\n')}
       ${extra}`
    );
  const run = (
    rows: string[],
    declared: number | number[],
    commit: boolean | string = false
  ) => {
    const sql = zeroSql.replace(
      '-- <<< REVIEWED ROWS ABOVE',
      `${load(rows, declared)}\n-- <<<`
    );
    const file = join(s.dir, 'run.sql');
    writeFileSync(file, sql);
    const mode =
      commit === true ? 'commit' : typeof commit === 'string' ? commit : null;
    return s.psql('', file, mode ? [`zero_out_mode=${mode}`] : []);
  };
  const balance = (w: string) =>
    s
      .psql(`SELECT available_balance FROM customer_wallets WHERE id='${w}'`)
      .stdout.trim();
  const ledgerRows = () =>
    s
      .psql(
        `SELECT count(*) FROM customer_wallet_transactions WHERE source_type='piggyvest_legacy_migration'`
      )
      .stdout.trim();
  return { reset, run, balance, ledgerRows };
};
