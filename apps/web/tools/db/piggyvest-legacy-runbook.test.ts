import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../../docs');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');

const runbook = read('piggyvest-legacy-migration-runbook.md');
const listSql = read('piggyvest-legacy-migration/01-balance-list.sql');
const zeroSql = read('piggyvest-legacy-migration/02-zero-out.sql');
const code = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

describe('01-balance-list.sql (coordinator list)', () => {
  const sql = code(listSql);

  it('is read only and never writes', () => {
    expect(sql).toMatch(/BEGIN\s+READ\s+ONLY/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    expect(sql).toMatch(/ROLLBACK/i);
  });

  it('selects explicit columns and only positive balances', () => {
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(sql).not.toMatch(/\w+\.\*/);
    expect(sql).toMatch(/available_balance\s*>\s*0/);
  });

  it('flags wallets whose stored balance disagrees with the ledger', () => {
    expect(sql).toMatch(/matches_ledger/);
    expect(sql).toMatch(/IS NOT DISTINCT FROM/i);
  });

  it('counts pending ledger rows and marks eligibility', () => {
    expect(sql).toMatch(/pending_count/);
    expect(sql).toMatch(/AS eligible/);
  });
});

describe('02-zero-out.sql (the one reviewed update)', () => {
  const sql = code(zeroSql);

  it('runs in one transaction that defaults to ROLLBACK', () => {
    expect(sql).toMatch(/^\s*BEGIN;/im);
    expect(sql).toMatch(/^\s*ROLLBACK;/im);
    expect(sql).toMatch(
      /\\if :do_commit\s+COMMIT;\s+\\else\s+ROLLBACK;\s+\\endif/
    );
    expect(sql).toMatch(/zero_out_mode/);
  });

  it('refuses an empty list and reports row counts', () => {
    expect(sql).toMatch(/list is empty/i);
    expect(sql).toMatch(/GET DIAGNOSTICS/i);
  });

  it('keys every row to merchant, customer, wallet and credit reference', () => {
    for (const col of [
      'wallet_id',
      'merchant_id',
      'customer_id',
      'expected_balance',
      'piggyvest_credit_reference',
    ]) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/expected_balance\s+numeric\(12,2\)\s+NOT NULL/i);
    expect(sql).toMatch(/expected_balance\s*>\s*0/);
  });

  it('locks wallets, then compares exact balance null-safely', () => {
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(/IS DISTINCT FROM/i);
    const lockAt = sql.search(/FOR UPDATE/i);
    const clockAt = sql.search(/clock_timestamp\(\)/i);
    expect(lockAt).toBeGreaterThan(-1);
    expect(clockAt).toBeGreaterThan(lockAt);
    expect(sql).not.toMatch(/\bnow\(\)/i);
  });

  it('writes a balanced ledger row and only ever sets balance to zero', () => {
    expect(sql).toMatch(/customer_wallet_transactions/);
    expect(sql).toMatch(/'debit'/);
    expect(sql).toMatch(/piggyvest_legacy_migration/);
    expect(sql).toMatch(/available_balance\s*=\s*0/);
    expect(sql).toMatch(/available_balance\s*=\s*l\.expected_balance/);
    expect(sql).not.toMatch(/total_(earned|redeemed)\s*=/);
  });

  it('refuses pending rows and checks a declared row count', () => {
    expect(sql).toMatch(/status\s*=\s*'pending'/);
    expect(sql).toMatch(/pending ledger row/);
    expect(sql).toMatch(/row count mismatch/);
    expect(zeroSql).toContain('ON_ERROR_STOP=1');
  });

  it('cannot run twice for the same wallet', () => {
    expect(sql).toMatch(/already (migrated|zeroed)/i);
  });

  it('never selects star and ships with an empty reviewed list', () => {
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(zeroSql).toContain('-- >>> REVIEWED ROWS BELOW');
    expect(zeroSql).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe('runbook', () => {
  it('has the required sections in order', () => {
    const order = [
      '## Before you start',
      '## 1. Coordinator list',
      '## 2. Credit each customer by hand in PiggyVest',
      '## 3. Record each credit',
      '## 4. Dry run the SQL update',
      '## 5. Commit and verify',
      '## If something goes wrong',
    ].map((h) => runbook.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('points at both SQL files and forbids production work by agents', () => {
    expect(runbook).toContain('01-balance-list.sql');
    expect(runbook).toContain('02-zero-out.sql');
    expect(runbook).toMatch(/owner/i);
    expect(runbook).toMatch(/credit before|credit first|only after/i);
  });
});

describe('runbook late-credit guard', () => {
  it('keeps the pause past commit and bars a second PiggyVest credit', () => {
    expect(runbook).toMatch(/Keep the pause[\s\S]*after the commit/);
    expect(runbook).toMatch(/at least\s+one hour/);
    expect(runbook).toMatch(/do NOT credit PiggyVest a second\s+time/);
  });
});

describe('runbook review roles and working copy', () => {
  const workingCopy = '~/piggyvest-legacy/02-zero-out.filled.sql';

  it('has no second person; the coordinator re-checks against the owner record', () => {
    expect(runbook).not.toMatch(/second person/i);
    expect(runbook).toMatch(
      /coordinator re-checks every row against the owner's recorded credits/
    );
  });

  it('uses one filled working copy outside the repo for dry run and commit', () => {
    const dry = runbook.slice(
      runbook.indexOf('### Dry run on the real schema'),
      runbook.indexOf('## 2. Credit')
    );
    const step4 = runbook.slice(
      runbook.indexOf('## 4. Dry run'),
      runbook.indexOf('## 5. Commit')
    );
    const step5 = runbook.slice(
      runbook.indexOf('## 5. Commit'),
      runbook.indexOf('## If something')
    );
    for (const part of [dry, step4, step5]) {
      expect(part).toContain(workingCopy);
    }
    expect(step5).not.toContain(
      '-f docs/piggyvest-legacy-migration/02-zero-out.sql'
    );
  });
});

describe('zero-out customer check is per row', () => {
  it('locks matched customers first, then counts rows with no matching customer', () => {
    const body = code(zeroSql);
    expect(body).toMatch(/FOR SHARE OF c/i);
    expect(body).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.customers c/i
    );
    expect(body).not.toMatch(/customer_id NOT IN/i);
  });
});

describe('runbook spending pause', () => {
  it('makes the pause mandatory and verified before any credit', () => {
    expect(runbook).not.toMatch(
      /Pause the old wallet spending paths for these customers if any/
    );
    expect(runbook).toMatch(/Pause every old wallet spending path/);
    expect(runbook).toMatch(/verify[\s\S]{0,200}no spend path can debit/i);
    const before = runbook.indexOf('## Before you start');
    const credit = runbook.indexOf('## 2. Credit');
    expect(
      runbook.indexOf('Pause every old wallet spending path')
    ).toBeGreaterThan(before);
    expect(
      runbook.indexOf('Pause every old wallet spending path')
    ).toBeLessThan(credit);
  });
});

describe('zero-out customer row lock', () => {
  it('locks the matched customers rows FOR SHARE before the wallet updates', () => {
    const body = code(zeroSql);
    const share = body.search(/FOR SHARE OF c/i);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(body.search(/UPDATE public\.customer_wallets/i));
  });
});

describe('ci filter for the runbook gate', () => {
  it('re-runs the runbook tests when CI scope plumbing changes', () => {
    const filters = readFileSync(
      resolve(__dirname, '../../../../.github/filters/ci.yml'),
      'utf8'
    );
    const key = 'piggyvest_runbook:';
    const start = filters.indexOf(key);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = filters.slice(start + key.length);
    const next = rest.search(/^\S.*:\s*$/m);
    const block = next === -1 ? rest : rest.slice(0, next);
    for (const p of [
      '.github/filters/ci.yml',
      '.github/workflows/ci.yml',
      '.github/scripts/resolve-ci-change-scope.sh',
    ]) {
      expect(block).toContain(`'${p}'`);
    }
  });
});
