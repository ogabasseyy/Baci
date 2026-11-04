import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '../../../..');
const legacyDir = resolve(repo, 'docs/piggyvest-legacy-migration');
const migrationsDir = resolve(repo, 'supabase/migrations');

export interface LedgerRow {
  status: string;
  type: string;
  amount: number;
  sourceType?: string;
}

interface Rule {
  status: string;
  types: string[];
  sign: 1 | -1;
}

export const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

export const readLegacySql = (name: string): string =>
  readFileSync(resolve(legacyDir, name), 'utf8');

/** Newest migration that (re)defines the function the app rebuilds balances with. */
export const readAppBackfillSql = (): { file: string; sql: string } => {
  const defines =
    /create\s+or\s+replace\s+function\s+public\.backfill_wallet_balances\s*\(/i;
  const file = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) =>
      defines.test(readFileSync(resolve(migrationsDir, f), 'utf8'))
    )
    .sort()
    .at(-1);
  if (!file) throw new Error('backfill_wallet_balances migration not found');
  return { file, sql: readFileSync(resolve(migrationsDir, file), 'utf8') };
};

/** First CASE ... END after the anchor text, comments removed. */
export const caseAfter = (sql: string, anchor: string): string => {
  const body = stripComments(sql);
  const from = body.indexOf(anchor);
  if (from < 0) throw new Error(`anchor not found: ${anchor}`);
  const start = body.indexOf('CASE', from);
  const end = body.indexOf('END', start);
  if (start < 0 || end < 0) throw new Error(`no CASE after: ${anchor}`);
  return body.slice(start, end + 3);
};

const BRANCH =
  /WHEN\s+\w+\.status\s*=\s*'(\w+)'\s+AND\s+\w+\.type\s+(?:IN\s*\(([^)]*)\)|=\s*'(\w+)')\s+THEN\s+(-?)\w+\.amount/gi;

export const parseRules = (caseSql: string): Rule[] => {
  const rules = [...caseSql.matchAll(BRANCH)].map((m) => ({
    status: m[1],
    types: (m[2] ?? `'${m[3]}'`)
      .split(',')
      .map((t) => t.trim().replace(/'/g, ''))
      .filter(Boolean),
    sign: (m[4] === '-' ? -1 : 1) as 1 | -1,
  }));
  const whens = (caseSql.match(/\bWHEN\b/gi) ?? []).length;
  if (rules.length === 0 || rules.length !== whens) {
    throw new Error(`unparsed WHEN branch: parsed ${rules.length} of ${whens}`);
  }
  if (!/ELSE\s+0\b/i.test(caseSql)) throw new Error('CASE has no ELSE 0');
  return rules;
};

/** Cents arithmetic, so the comparison is exact. First matching branch wins. */
export const ledgerTotalCents = (rules: Rule[], rows: LedgerRow[]): number =>
  rows.reduce((sum, row) => {
    const rule = rules.find(
      (r) => r.status === row.status && r.types.includes(row.type)
    );
    return sum + (rule ? rule.sign * Math.round(row.amount * 100) : 0);
  }, 0);
