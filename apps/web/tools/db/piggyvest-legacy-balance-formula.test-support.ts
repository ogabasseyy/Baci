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

/**
 * Drops `--` comments (whole-line and trailing), leaving string literals
 * intact, including literals that span several lines.
 */
export const stripComments = (sql: string): string => {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (!inString && ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      if (i < sql.length) out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
};

export const readLegacySql = (name: string): string =>
  readFileSync(resolve(legacyDir, name), 'utf8');

const NAME = '"?backfill_wallet_balances"?';
const DEFINES = new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${NAME}\\s*\\(`,
  'i'
);
const DROPS = new RegExp(`drop\\s+function[^;]*${NAME}`, 'i');
const MENTIONS = /backfill_wallet_balances/i;
const BENIGN = new RegExp(
  `(?:revoke|grant|comment\\s+on\\s+function)\\b[^;]*${NAME}[^;]*;`,
  'gi'
);

/**
 * Newest migration that (re)defines the function the app rebuilds balances with.
 * Fails loud if a later migration drops it or touches it in a way this guard
 * cannot classify, so it never silently falls back to an older definition.
 */
export const selectBackfillDefinition = (
  files: { name: string; sql: string }[]
): { file: string; sql: string } => {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const bodies = new Map(sorted.map((f) => [f.name, stripComments(f.sql)]));
  const newest = sorted.filter((f) => DEFINES.test(bodies.get(f.name) ?? ''));
  const latest = newest.at(-1);
  if (!latest) throw new Error('backfill_wallet_balances migration not found');
  for (const f of sorted) {
    if (f.name <= latest.name) continue;
    const body = bodies.get(f.name) ?? '';
    if (DROPS.test(body)) {
      throw new Error(`${f.name} drops backfill_wallet_balances`);
    }
    if (MENTIONS.test(body.replace(BENIGN, ''))) {
      throw new Error(
        `${f.name} touches backfill_wallet_balances in an unrecognised way`
      );
    }
  }
  return { file: latest.name, sql: latest.sql };
};

export const readAppBackfillSql = (): { file: string; sql: string } =>
  selectBackfillDefinition(
    readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .map((name) => ({
        name,
        sql: readFileSync(resolve(migrationsDir, name), 'utf8'),
      }))
  );

/** First CASE ... END after the anchor text, comments removed. */
export const caseAfter = (sql: string, anchor: string): string => {
  const body = stripComments(sql);
  const from = body.indexOf(anchor);
  if (from < 0) throw new Error(`anchor not found: ${anchor}`);
  const start = body.slice(from).search(/\bCASE\b/i);
  const rest = start < 0 ? '' : body.slice(from + start);
  const end = rest.search(/\bEND\b/i);
  if (start < 0 || end < 0) throw new Error(`no CASE after: ${anchor}`);
  return rest.slice(0, end + 3);
};

/**
 * A branch result must be exactly `[-]alias.amount` and the CASE must end with
 * `ELSE 0 END`; any trailing expression makes the branch unparsed on purpose.
 */
const BRANCH =
  /WHEN\s+\w+\.status\s*=\s*'(\w+)'\s+AND\s+\w+\.type\s+(?:IN\s*\(([^)]*)\)|=\s*'(\w+)')\s+THEN\s+(-?)\w+\.amount(?=\s+(?:WHEN|ELSE)\b)/gi;

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
  if (!/\bELSE\s+0\s+END$/i.test(caseSql.trim())) {
    throw new Error('CASE must end with exactly ELSE 0 END');
  }
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

/** Whitespace-collapsed, comment-free SQL with no padding inside parentheses. */
export const normalizeSql = (sql: string): string =>
  stripComments(sql)
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .trim();

/**
 * The statement text with the first CASE after the anchor collapsed to
 * `<CASE>`, so joins, filters and the aggregate around it can be pinned.
 */
export const shapeAround = (sql: string, anchor: string): string => {
  const body = stripComments(sql);
  const kase = caseAfter(body, anchor);
  const at = body.indexOf(kase, body.indexOf(anchor));
  return normalizeSql(
    `${body.slice(0, at)}<CASE>${body.slice(at + kase.length)}`
  );
};
