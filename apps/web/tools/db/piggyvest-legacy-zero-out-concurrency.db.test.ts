import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binDir,
  C1,
  C2,
  docsDir,
  M,
  type Scratch,
  startScratch,
  W1,
  W2,
} from './piggyvest-legacy-runbook.db-support';

// Two overlapping runs of 02-zero-out.sql that reuse one PiggyVest reference
// for different wallets. Run A holds the run lock and stays open for a while;
// run B starts meanwhile. Without the run lock both pass the reference check.
const zeroSql = readFileSync(join(docsDir, '02-zero-out.sql'), 'utf8');

const script = (wallet: string, customer: string, amt: string, hold: boolean) =>
  zeroSql
    .replace(
      '-- <<< REVIEWED ROWS ABOVE',
      `INSERT INTO legacy_zero_out_declared (expected_rows) VALUES (1);
INSERT INTO legacy_zero_out_list (wallet_id, merchant_id, customer_id, expected_balance, piggyvest_credit_reference)
VALUES ('${wallet}','${M}','${customer}',${amt},'PV-SHARED-REF');
-- <<<`
    )
    .replace(
      "SELECT (:'zero_out_mode' = 'commit') AS do_commit \\gset",
      (gset) => `${hold ? 'SELECT pg_sleep(3);\n' : ''}${gset}`
    );

describe.skipIf(!binDir)('02-zero-out.sql overlapping runs', () => {
  let s: Scratch;
  const count = (sql: string) => Number(s.psql(sql).stdout.trim());
  // Polls the server with a bounded number of checks, yielding to the event
  // loop between them, until the condition query returns at least 1.
  const waitFor = async (sql: string, running: () => string) => {
    for (let i = 0; i < 400; i++) {
      if (count(sql) >= 1) return;
      await new Promise<void>((next) => setImmediate(next));
    }
    throw new Error(`never became true: ${sql}; run A: ${running()}`);
  };
  const runLock = `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted
    AND objsubid = 1 AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('baci:piggyvest_legacy_zero_out', 0)`;

  beforeAll(() => {
    s = startScratch();
  }, 60_000);
  afterAll(() => s?.stop());

  it('lets only one run use a PiggyVest reference', async () => {
    const seed =
      `INSERT INTO customers (id, merchant_id, full_name) VALUES ('${C1}','${M}','One'),('${C2}','${M}','Two');
    ` +
      [
        [W1, C1, '500.00'],
        [W2, C2, '250.00'],
      ]
        .map(
          ([w, c, b]) =>
            `INSERT INTO customer_wallets (id, customer_id, merchant_id, available_balance) VALUES ('${w}','${c}','${M}',${b});
           INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status) VALUES ('${w}','${c}','${M}','credit',${b},${b},'completed');`
        )
        .join('\n');
    expect(s.psql(seed).status).toBe(0);
    const fileA = join(s.dir, 'a.sql');
    const fileB = join(s.dir, 'b.sql');
    writeFileSync(fileA, script(W1, C1, '500.00', true));
    writeFileSync(fileB, script(W2, C2, '250.00', false));

    let state = 'still running';
    const a = s.psqlFileAsync(fileA, ['zero_out_mode=commit']).then((r) => {
      state = `exit ${r.status}: ${r.stderr}`;
      return r;
    });
    await waitFor(runLock, () => state);
    const b = s.psqlFileAsync(fileB, ['zero_out_mode=commit']);
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.status).toBe(0);
    expect(rb.status).not.toBe(0);
    expect(rb.stderr).toMatch(/reference already used|lock timeout/);
    expect(
      count(
        `SELECT count(*) FROM customer_wallet_transactions WHERE source_type = 'piggyvest_legacy_migration'`
      )
    ).toBe(1);
    expect(
      count(`SELECT available_balance FROM customer_wallets WHERE id = '${W2}'`)
    ).toBe(250);
  }, 30_000);

  it('fences the ledger table while a run is open', async () => {
    expect(
      s.psql(
        `DELETE FROM customer_wallet_transactions; DELETE FROM customer_wallets;
         INSERT INTO customer_wallets (id, customer_id, merchant_id, available_balance) VALUES ('${W1}','${C1}','${M}',500);
         INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status) VALUES ('${W1}','${C1}','${M}','credit',500,500,'completed');`
      ).status
    ).toBe(0);
    const file = join(s.dir, 'fence.sql');
    writeFileSync(file, script(W1, C1, '500.00', true));
    let state = 'still running';
    const a = s.psqlFileAsync(file, ['zero_out_mode=commit']).then((r) => {
      state = `exit ${r.status}: ${r.stderr}`;
      return r;
    });
    await waitFor(
      `SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
       WHERE l.granted AND l.mode = 'ShareRowExclusiveLock' AND c.relname = 'customer_wallet_transactions'`,
      () => state
    );
    const blocked = s.psql(
      `SET lock_timeout = '300ms';
       INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status)
       VALUES ('${W1}','${C1}','${M}','credit',1,501,'completed');`
    );
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toMatch(/lock timeout/);
    expect((await a).status).toBe(0);
  }, 30_000);
});
