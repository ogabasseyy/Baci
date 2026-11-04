import { describe, expect, it } from 'vitest';
import {
  caseAfter,
  parseRules,
  selectBackfillDefinition,
  shapeAround,
  stripComments,
} from './piggyvest-legacy-balance-formula.test-support';

const def = (header: string) =>
  `${header} public.backfill_wallet_balances() RETURNS void AS $$ x $$;`;

describe('selectBackfillDefinition', () => {
  const old = {
    name: '20260501090716_a.sql',
    sql: def('CREATE OR REPLACE FUNCTION'),
  };

  it.each([
    ['plain create', 'CREATE FUNCTION public.backfill_wallet_balances()'],
    [
      'no schema prefix',
      'create or replace function backfill_wallet_balances()',
    ],
    [
      'quoted name',
      'CREATE OR REPLACE FUNCTION public."backfill_wallet_balances" ()',
    ],
    [
      'multi-line',
      'CREATE\n  OR REPLACE\n  FUNCTION\n public.backfill_wallet_balances\n()',
    ],
  ])('sees a later definition written as %s', (_n, header) => {
    const later = {
      name: '20260601000000_b.sql',
      sql: `${header} RETURNS void;`,
    };
    expect(selectBackfillDefinition([old, later]).file).toBe(later.name);
  });

  it('fails when a later migration drops the function', () => {
    const drop = {
      name: '20260601000000_b.sql',
      sql: 'DROP FUNCTION IF EXISTS public.backfill_wallet_balances();',
    };
    expect(() => selectBackfillDefinition([old, drop])).toThrow(/drop/i);
  });

  it('fails when a later migration alters or mentions it unrecognised', () => {
    const alter = {
      name: '20260601000000_b.sql',
      sql: 'ALTER FUNCTION public.backfill_wallet_balances() RENAME TO x;',
    };
    expect(() => selectBackfillDefinition([old, alter])).toThrow(
      /unrecognised/i
    );
  });

  it('ignores later grants, revokes, comments and comment-only mentions', () => {
    const benign = {
      name: '20260601000000_b.sql',
      sql: [
        '-- backfill_wallet_balances rebuilds balances',
        'REVOKE ALL ON FUNCTION public.backfill_wallet_balances() FROM PUBLIC;',
        'GRANT EXECUTE ON FUNCTION public.backfill_wallet_balances() TO service_role;',
        "COMMENT ON FUNCTION public.backfill_wallet_balances() IS 'x';",
      ].join('\n'),
    };
    expect(selectBackfillDefinition([old, benign]).file).toBe(old.name);
  });

  it('throws when no definition exists', () => {
    expect(() => selectBackfillDefinition([])).toThrow(/not found/);
  });
});

describe('inline comments', () => {
  it('strips trailing comments but keeps dashes inside strings', () => {
    expect(stripComments("a -- END\nb 'x--y' -- WHEN")).toBe("a \nb 'x--y' ");
  });

  it('keeps a dashed line inside a multi-line string literal', () => {
    expect(stripComments("a 'x\n-- not a comment\ny' -- gone\nb")).toBe(
      "a 'x\n-- not a comment\ny' \nb"
    );
  });

  it('reads lowercase case/end keywords', () => {
    const sql =
      "x case when a.status = 'completed' and a.type = 'credit' then a.amount else 0 end";
    expect(parseRules(caseAfter(sql, 'x'))).toHaveLength(1);
  });

  it('does not let an inline END or WHEN comment break the CASE slice', () => {
    const sql = [
      'WITH l AS (SELECT',
      "CASE WHEN t.status = 'completed' AND t.type = 'credit' THEN t.amount -- legacy END",
      "-- WHEN t.status = 'x' AND t.type = 'y' THEN t.amount",
      "WHEN t.status = 'completed' AND t.type = 'debit' THEN -t.amount -- WHEN",
      'ELSE 0 END)',
    ].join('\n');
    expect(parseRules(caseAfter(sql, 'WITH l AS'))).toHaveLength(2);
  });

  it('matches END as a whole word only', () => {
    const sql =
      "x CASE WHEN a.status = 'completed' AND a.type = 'credit' THEN a.amount ELSE 0 ENDING END";
    expect(caseAfter(sql, 'x')).toMatch(/ENDING END$/);
  });
});

describe('strict CASE results', () => {
  const when = (then: string, tail = 'ELSE 0 END') =>
    `CASE WHEN x.status = 'completed' AND x.type = 'credit' THEN ${then} ${tail}`;

  it('accepts the plain and negated amount with ELSE 0 END', () => {
    expect(parseRules(when('x.amount'))).toHaveLength(1);
    expect(parseRules(when('-x.amount'))[0].sign).toBe(-1);
  });

  it.each([
    ['a multiplied amount', when('x.amount * 2')],
    ['a zeroed amount', when('x.amount * 0')],
    ['an added term', when('x.amount + 1')],
    ['a fractional ELSE', when('x.amount', 'ELSE 0.5 END')],
    ['an ELSE with a trailing term', when('x.amount', 'ELSE 0 + x.amount END')],
    ['a non-zero ELSE', when('x.amount', 'ELSE 1 END')],
  ])('rejects %s instead of reading its prefix', (_n, caseSql) => {
    expect(() => parseRules(caseSql)).toThrow();
  });
});

describe('surrounding statement shape', () => {
  const sql = [
    'WITH t AS (SELECT w.id, COALESCE(SUM(',
    "CASE WHEN a.status = 'completed' AND a.type = 'credit' THEN a.amount ELSE 0 END",
    '), 0) AS bal -- note',
    'FROM public.w w JOIN public.a a ON a.w = w.id GROUP BY w.id)',
  ].join('\n');

  it('collapses the CASE and normalises whitespace and comments', () => {
    expect(shapeAround(sql, 'WITH t AS')).toBe(
      'WITH t AS (SELECT w.id, COALESCE(SUM(<CASE>), 0) AS bal FROM public.w w JOIN public.a a ON a.w = w.id GROUP BY w.id)'
    );
  });

  it('reports a missing fragment by name', () => {
    expect(() => shapeAround(sql, 'nope')).toThrow(/anchor not found/);
  });
});
