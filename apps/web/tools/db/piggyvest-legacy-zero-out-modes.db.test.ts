import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binDir,
  C1,
  C2,
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
describe.skipIf(!binDir)(
  '02-zero-out.sql references, modes and ownership',
  () => {
    let s: Scratch;
    const { reset, run, balance, ledgerRows } = makeHarness(() => s);

    beforeAll(() => {
      s = startScratch();
    }, 60_000);
    afterAll(() => s?.stop());

    it('allows placeholder references in the ROLLBACK dry run', () => {
      reset([[W1, '500.00']]);
      expect(run([row(W1, C1, '500.00', 'DRY-RUN-1')], 1).status).toBe(0);
      expect(balance(W1)).toBe('500.00');
    });

    it('commits with real references when zero_out_mode=commit', () => {
      reset([[W1, '500.00']]);
      expect(run([row(W1, C1, '500.00', 'PV-REAL-1')], 1, true).status).toBe(0);
      expect(balance(W1)).toBe('0.00');
    });

    it('rolls back with an explicit dry_run mode', () => {
      reset([[W1, '500.00']]);
      expect(run([row(W1, C1, '500.00')], 1, 'dry_run').status).toBe(0);
      expect(balance(W1)).toBe('500.00');
    });

    it('refuses an unknown zero_out_mode and changes nothing', () => {
      reset([[W1, '500.00']]);
      const r = run([row(W1, C1, '500.00')], 1, 'yes');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/zero_out_mode must be/);
      expect(balance(W1)).toBe('500.00');
    });

    it.each([
      'DRY-RUN-1',
      'dry run 2',
      'PLACEHOLDER',
      'TEST-1',
      'tbd',
    ])('refuses placeholder reference %s on a COMMIT run', (ref) => {
      reset([[W1, '500.00']]);
      const r = run([row(W1, C1, '500.00', ref)], 1, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/placeholder PiggyVest reference/);
      expect(balance(W1)).toBe('500.00');
      expect(ledgerRows()).toBe('0');
    });

    it('refuses one PiggyVest reference used for two wallets', () => {
      reset([
        [W1, '500.00'],
        [W2, '250.00'],
      ]);
      const r = run(
        [row(W1, C1, '500.00', 'PV-SAME'), row(W2, C2, '250.00', 'PV-SAME')],
        2,
        true
      );
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/legacy_zero_out_reference_uq/);
      expect(balance(W1)).toBe('500.00');
      expect(balance(W2)).toBe('250.00');
    });

    it('refuses a reference already recorded for another wallet', () => {
      reset([
        [W1, '500.00'],
        [W2, '250.00'],
      ]);
      expect(run([row(W1, C1, '500.00', 'PV-USED')], 1, true).status).toBe(0);
      const r = run([row(W2, C2, '250.00', ' pv-used ')], 1, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/reference already used/);
      expect(balance(W2)).toBe('250.00');
    });

    it('refuses two declared-count rows', () => {
      reset([[W1, '500.00']]);
      const r = run([row(W1, C1, '500.00')], [1, 5], true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/exactly one declared/);
      expect(balance(W1)).toBe('500.00');
    });

    it('refuses a listed wallet that does not exist', () => {
      reset([[W1, '500.00']]);
      const r = run([row(W1, C1, '500.00'), row(W2, C2, '250.00')], 2, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/wallet missing/);
      expect(balance(W1)).toBe('500.00');
      expect(ledgerRows()).toBe('0');
    });

    it('refuses swapped customer ids against the wallet', () => {
      reset([[W1, '500.00']]);
      const r = run([row(W1, C2, '500.00')], 1, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/owner mismatch/);
      expect(balance(W1)).toBe('500.00');
    });

    it('refuses a wallet whose merchant differs from the list', () => {
      reset([[W1, '500.00']]);
      s.psql(
        `UPDATE customer_wallets SET merchant_id = '${C2}' WHERE id='${W1}'`
      );
      const r = run([row(W1, C1, '500.00')], 1, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/owner mismatch/);
      expect(balance(W1)).toBe('500.00');
    });

    it('refuses a wallet whose customer is missing for the merchant', () => {
      reset([[W1, '500.00']]);
      s.psql(`DELETE FROM customers WHERE id='${C1}'`);
      const r = run([row(W1, C1, '500.00')], 1, true);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/customer not found/);
      expect(balance(W1)).toBe('500.00');
      expect(ledgerRows()).toBe('0');
    });

    it('refuses a cross-merchant row even when the customer matches another row', () => {
      const M2 = 'bbbbbbbb-0000-4000-8000-00000000000b';
      reset([
        [W1, '500.00'],
        [W2, '250.00'],
      ]);
      s.psql(
        `UPDATE customer_wallets SET merchant_id='${M2}', customer_id='${C1}' WHERE id='${W2}'`
      );
      const r = run(
        [row(W1, C1, '500.00'), `('${W2}','${M2}','${C1}',250.00,'PV-REF-X')`],
        2,
        true
      );
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/customer not found/);
      expect(balance(W1)).toBe('500.00');
      expect(balance(W2)).toBe('250.00');
      expect(ledgerRows()).toBe('0');
    });
  }
);
