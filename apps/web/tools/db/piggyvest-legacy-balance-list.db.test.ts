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
  W3,
  W4,
} from './piggyvest-legacy-runbook.db-support';

// Executes 01-balance-list.sql against a scratch Postgres cluster.
describe('real-database evidence availability', () => {
  it('is present when REQUIRE_PG_TESTS=1', () => {
    if (process.env.REQUIRE_PG_TESTS === '1') {
      expect(binDir).toBeDefined();
    }
  });
});

describe.skipIf(!binDir)(
  '01-balance-list.sql against a scratch Postgres',
  () => {
    let s: Scratch;
    const listFile = join(docsDir, '01-balance-list.sql');
    const tx = (w: string, type: string, amt: string, status: string) =>
      `INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status)
     VALUES ('${w}','${C1}','${M}','${type}',${amt},0,'${status}');`;
    const wallet = (w: string, bal: string) =>
      `INSERT INTO customer_wallets (id, customer_id, merchant_id, available_balance) VALUES ('${w}','${C1}','${M}',${bal});`;
    const list = () => {
      const r = s.psql('', listFile);
      expect(r.status).toBe(0);
      return Object.fromEntries(
        r.stdout
          .split('\n')
          .filter((l: string) => l.includes('|'))
          .map((l: string): [string, string[]] => {
            const c = l.split('|');
            // wallet_id|...|legacy|ledger|matches|pending|eligible|over|migrated|customer_found|updated
            return [c[0], c.slice(6)];
          })
      );
    };
    const seed = (sql: string) =>
      s.psql(
        `DELETE FROM customer_wallet_transactions; DELETE FROM customer_wallets;
         INSERT INTO customers (id, merchant_id, full_name) VALUES ('${C1}','${M}','One') ON CONFLICT DO NOTHING;
         ${sql}`
      );

    beforeAll(() => {
      s = startScratch();
    }, 60_000);
    afterAll(() => s?.stop());

    it('counts an expired expiry row as a debit, like the canonical rebuild', () => {
      seed(
        `${wallet(W1, '80.00')} ${tx(W1, 'credit', '100', 'completed')} ${tx(W1, 'expiry', '20', 'expired')}`
      );
      expect(list()[W1].slice(0, 5)).toEqual(['80.00', '80.00', 't', '0', 't']);
    });

    it('marks a wallet with a pending row ineligible', () => {
      seed(
        `${wallet(W3, '100.00')} ${tx(W3, 'credit', '100', 'completed')} ${tx(W3, 'redemption', '10', 'pending')}`
      );
      expect(list()[W3][4]).toBe('f');
    });

    it('marks a balance above the zero-out limit ineligible', () => {
      seed(
        `${wallet(W4, '100000000.00')} ${tx(W4, 'credit', '60000000', 'completed')} ${tx(W4, 'credit', '40000000', 'completed')}`
      );
      const r = list()[W4];
      expect(r[2]).toBe('t');
      expect(r[4]).toBe('f');
      expect(r[5]).toBe('t');
    });

    it('marks a migrated wallet with a late credit ineligible and flagged', () => {
      seed(
        `${wallet(W1, '30.00')} ${tx(W1, 'credit', '100', 'completed')}
         INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, source_type, status)
         VALUES ('${W1}','${C1}','${M}','debit',100,0,'piggyvest_legacy_migration','completed');
         ${tx(W1, 'credit', '30', 'completed')}`
      );
      const r = list()[W1];
      // The ledger agrees (30 = 100 - 100 + 30), yet the owner already paid.
      expect(r.slice(0, 3)).toEqual(['30.00', '30.00', 't']);
      expect(r[4]).toBe('f');
      expect(r[6]).toBe('t');
    });

    it('flags an untouched wallet as not migrated', () => {
      seed(`${wallet(W1, '50.00')} ${tx(W1, 'credit', '50', 'completed')}`);
      const r = list()[W1];
      expect(r[4]).toBe('t');
      expect(r[6]).toBe('f');
    });

    it('lists only positive-balance wallets', () => {
      seed(
        `${wallet(W1, '0.00')} ${tx(W1, 'credit', '10', 'completed')}
         ${wallet(W3, '10.00')} ${tx(W3, 'credit', '10', 'completed')}`
      );
      expect(Object.keys(list())).toEqual([W3]);
    });

    it('marks a wallet with no matching customer ineligible and flagged', () => {
      seed(
        `${wallet(W1, '50.00')} ${tx(W1, 'credit', '50', 'completed')}
         DELETE FROM customers;`
      );
      const r = list()[W1];
      expect(r[4]).toBe('f');
      expect(r[7]).toBe('f');
    });

    it('marks a wallet whose customer belongs to another merchant ineligible', () => {
      seed(
        `${wallet(W1, '50.00')} ${tx(W1, 'credit', '50', 'completed')}
         UPDATE customers SET merchant_id = '${C2}';`
      );
      expect(list()[W1][4]).toBe('f');
    });
  }
);
