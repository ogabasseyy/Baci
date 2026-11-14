import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binDir,
  C1,
  C2,
  M,
  type Scratch,
  startScratch,
  W1,
  W2,
} from './piggyvest-legacy-runbook.db-support';
import { makeHarness, row } from './piggyvest-legacy-zero-out.db-harness';

// Runs the real zero-out script against a scratch Postgres cluster that holds
// minimal stand-ins for the wallet tables. Skipped (with a warning) when no
// local Postgres binaries exist; the availability test in
// piggyvest-legacy-balance-list.db.test.ts fails when REQUIRE_PG_TESTS=1.
describe.skipIf(!binDir)('02-zero-out.sql against a scratch Postgres', () => {
  let s: Scratch;
  const { reset, run, balance, ledgerRows } = makeHarness(() => s);

  beforeAll(() => {
    s = startScratch();
  }, 60_000);
  afterAll(() => s?.stop());

  it('zeroes listed wallets and writes one ledger row each when committed', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00'), row(W2, C2, '250.00')], 2, true);
    expect(r.status).toBe(0);
    expect(balance(W1)).toBe('0.00');
    expect(balance(W2)).toBe('0.00');
    expect(ledgerRows()).toBe('2');
  });

  it('moves updated_at forward on a zeroed wallet', () => {
    reset([[W1, '500.00']]);
    expect(run([row(W1, C1, '500.00')], 1, true).status).toBe(0);
    const t = s
      .psql(
        `SELECT updated_at > '2020-01-02T00:00:00Z' FROM customer_wallets WHERE id='${W1}'`
      )
      .stdout.trim();
    expect(t).toBe('t');
  });

  it('refuses a wallet whose stored balance differs from its ledger', () => {
    reset([[W1, '500.00']]);
    s.psql(
      `UPDATE customer_wallet_transactions SET amount = 300, balance_after = 300 WHERE wallet_id='${W1}'`
    );
    const r = run([row(W1, C1, '500.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ledger/);
    expect(balance(W1)).toBe('500.00');
    expect(ledgerRows()).toBe('0');
  });

  it('counts an expired expiry row when comparing with the ledger', () => {
    reset(
      [[W1, '80.00']],
      `UPDATE customer_wallet_transactions SET amount = 100 WHERE wallet_id='${W1}';
       INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status)
       VALUES ('${W1}','${C1}','${M}','expiry',20,80,'expired');`
    );
    expect(run([row(W1, C1, '80.00')], 1, true).status).toBe(0);
    expect(balance(W1)).toBe('0.00');
  });

  it('changes nothing in the default dry run', () => {
    reset([[W1, '500.00']]);
    expect(run([row(W1, C1, '500.00')], 1).status).toBe(0);
    expect(balance(W1)).toBe('500.00');
    expect(ledgerRows()).toBe('0');
  });

  it('refuses a balance mismatch', () => {
    reset([[W1, '400.00']]);
    const r = run([row(W1, C1, '500.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/mismatch/);
    expect(balance(W1)).toBe('400.00');
  });

  it('refuses an empty list', () => {
    reset([[W1, '500.00']]);
    const r = run([], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/list is empty/);
    expect(balance(W1)).toBe('500.00');
  });

  it('refuses a second run for a migrated wallet', () => {
    reset([[W1, '500.00']]);
    expect(run([row(W1, C1, '500.00')], 1, true).status).toBe(0);
    s.psql(
      `UPDATE customer_wallets SET available_balance = 500 WHERE id='${W1}'`
    );
    const r = run([row(W1, C1, '500.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/already migrated/);
    expect(balance(W1)).toBe('500.00');
  });

  it('refuses a wallet with a pending ledger row', () => {
    reset(
      [[W1, '600.00']],
      `INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status)
       VALUES ('${W1}','${C1}','${M}','redemption',400,600,'pending');`
    );
    const r = run([row(W1, C1, '600.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pending ledger row/);
    expect(balance(W1)).toBe('600.00');
    expect(ledgerRows()).toBe('0');
  });

  it('refuses a declared count that differs from the loaded rows', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00')], 2, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/row count mismatch/);
    expect(balance(W1)).toBe('500.00');
  });

  it('writes nothing when one row of the insert is invalid', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00'), row(W2, C2, '0')], 2, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/legacy_zero_out_list_expected_balance_check/);
    expect(balance(W1)).toBe('500.00');
    expect(ledgerRows()).toBe('0');
  });
});
