/**
 * Scope: backfill_wallet_balances is the canonical ledger-rebuild formula.
 * Stored available_balance is also maintained by incremental RPC updates;
 * those paths are out of scope here. If one changes how a ledger type or
 * status counts, the rebuild and this guard must change with it.
 */
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_SHAPES,
  GATE_SHAPES,
} from './piggyvest-legacy-balance-formula.shapes';
import {
  caseAfter,
  type LedgerRow,
  ledgerTotalCents,
  normalizeSql,
  parseRules,
  readAppBackfillSql,
  readLegacySql,
  shapeAround,
  stripComments,
} from './piggyvest-legacy-balance-formula.test-support';

const app = readAppBackfillSql();
const listSql = readLegacySql('01-balance-list.sql');
const zeroSql = readLegacySql('02-zero-out.sql');

const formulas = {
  'app backfill_wallet_balances': parseRules(
    caseAfter(app.sql, 'WITH customer_rollup AS')
  ),
  '01-balance-list.sql': parseRules(caseAfter(listSql, 'ledger AS')),
  '02-zero-out.sql': parseRules(
    caseAfter(zeroSql, 'WHERE l.expected_balance IS DISTINCT FROM (')
  ),
};

const ANCHORS = {
  app: 'WITH customer_rollup AS',
  list: 'WITH positive AS',
  zero: 'WHERE l.expected_balance IS DISTINCT FROM (',
} as const;
const sources = { app: app.sql, list: listSql, zero: zeroSql } as const;
const missing = (text: string, fragments: readonly string[]) =>
  fragments.filter((f) => !text.includes(f));

const row = (status: string, type: string, amount: number): LedgerRow => ({
  status,
  type,
  amount,
});

// Every status and type the ledger domain allows, plus a few strangers.
const STATUSES = ['completed', 'pending', 'expired', 'failed', 'reversed'];
const TYPES = [
  'credit',
  'cashback',
  'bonus',
  'adjustment',
  'refund',
  'debit',
  'redemption',
  'expiry',
  'mystery',
];
const everyCombination: LedgerRow[] = STATUSES.flatMap((s, i) =>
  TYPES.map((t, j) => row(s, t, 10 + i * 9 + j + 0.37))
);

const fixtures: Record<string, LedgerRow[]> = {
  empty: [],
  'credits only': [
    row('completed', 'credit', 5000),
    row('completed', 'bonus', 12.5),
  ],
  'mixed completed': [
    row('completed', 'credit', 10000),
    row('completed', 'cashback', 250.25),
    row('completed', 'refund', 1000),
    row('completed', 'adjustment', 40),
    row('completed', 'debit', 3000.1),
    row('completed', 'redemption', 500),
    row('completed', 'expiry', 100),
  ],
  'pending is ignored': [
    row('completed', 'credit', 900),
    row('pending', 'credit', 777),
    row('pending', 'debit', 55),
  ],
  'expired expiry row is a debit': [
    row('completed', 'credit', 800),
    row('expired', 'expiry', 300),
    row('expired', 'credit', 999),
  ],
  'unknown types and statuses count for nothing': [
    row('completed', 'mystery', 123),
    row('failed', 'credit', 456),
    row('reversed', 'debit', 789),
  ],
  'every status and type': everyCombination,
  'balance goes negative': [row('completed', 'debit', 10)],
  'migration debit row': [
    { status: 'completed', type: 'credit', amount: 2500 },
    {
      status: 'completed',
      type: 'debit',
      amount: 2500,
      sourceType: 'piggyvest_legacy_migration',
    },
  ],
};

describe('legacy balance formula drift guard', () => {
  it('reads the newest backfill definition and parses every branch', () => {
    expect(app.file).toMatch(/^\d{14}_.*\.sql$/);
    for (const rules of Object.values(formulas)) {
      expect(rules.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('pins the known totals so a shared mistake cannot hide', () => {
    const app = formulas['app backfill_wallet_balances'];
    expect(ledgerTotalCents(app, fixtures['mixed completed'])).toBe(
      (10000 + 250.25 + 1000 + 40 - 3000.1 - 500 - 100) * 100
    );
    expect(ledgerTotalCents(app, fixtures['pending is ignored'])).toBe(90000);
    expect(
      ledgerTotalCents(app, fixtures['expired expiry row is a debit'])
    ).toBe(50000);
    expect(ledgerTotalCents(app, fixtures['balance goes negative'])).toBe(
      -1000
    );
    expect(ledgerTotalCents(app, fixtures['migration debit row'])).toBe(0);
  });

  describe.each(Object.entries(fixtures))('%s', (_name, ledger) => {
    const expected = ledgerTotalCents(
      formulas['app backfill_wallet_balances'],
      ledger
    );
    it.each([
      '01-balance-list.sql',
      '02-zero-out.sql',
    ] as const)('gives the same total in %s as the app', (source) => {
      expect(ledgerTotalCents(formulas[source], ledger)).toBe(expected);
    });
  });

  it('detects a changed sign, a dropped type or an extra status', () => {
    const base = caseAfter(listSql, 'ledger AS');
    const mutants = [
      base.replace("'debit', 'redemption', 'expiry'", "'debit', 'redemption'"),
      base.replace("'credit', 'cashback'", "'credit', 'cashback', 'mystery'"),
      base.replace('-cwt.amount', 'cwt.amount'),
      base.replace("cwt.status = 'expired'", "cwt.status = 'pending'"),
    ];
    const reference = formulas['app backfill_wallet_balances'];
    for (const mutant of mutants) {
      expect(mutant).not.toBe(base);
      const rules = parseRules(mutant);
      const differs = Object.values(fixtures).some(
        (ledger) =>
          ledgerTotalCents(rules, ledger) !==
          ledgerTotalCents(reference, ledger)
      );
      expect(differs).toBe(true);
    }
  });

  it.each(
    Object.keys(AGGREGATE_SHAPES) as (keyof typeof AGGREGATE_SHAPES)[]
  )('pins the join, filter and SUM around the CASE in %s', (key) => {
    const shape = shapeAround(sources[key], ANCHORS[key]);
    expect(missing(shape, AGGREGATE_SHAPES[key])).toEqual([]);
  });

  it('detects a row filter, FILTER clause or aggregate change around the CASE', () => {
    const mutate = (
      key: keyof typeof AGGREGATE_SHAPES,
      from: string,
      to: string
    ) => {
      const shape = shapeAround(sources[key], ANCHORS[key]);
      expect(shape).toContain(from);
      return shape.replace(from, to);
    };
    const mutants: [keyof typeof AGGREGATE_SHAPES, string, string][] = [
      [
        'app',
        'ON cwt.wallet_id = cw.id',
        "ON cwt.wallet_id = cw.id AND cwt.source_type <> 'x'",
      ],
      [
        'app',
        'COALESCE(SUM(<CASE>), 0) AS available_balance',
        'COALESCE(SUM(<CASE>) FILTER (WHERE cwt.created_at > now()), 0) AS available_balance',
      ],
      [
        'list',
        'JOIN positive p ON p.id = cwt.wallet_id',
        "JOIN positive p ON p.id = cwt.wallet_id AND cwt.source_type <> 'x'",
      ],
      [
        'list',
        'COALESCE(SUM(<CASE>), 0) AS ledger_balance',
        'COALESCE(MAX(<CASE>), 0) AS ledger_balance',
      ],
      [
        'zero',
        'WHERE t.wallet_id = l.wallet_id',
        "WHERE t.wallet_id = l.wallet_id AND t.status <> 'x'",
      ],
    ];
    for (const [key, from, to] of mutants) {
      expect(missing(mutate(key, from, to), AGGREGATE_SHAPES[key])).not.toEqual(
        []
      );
    }
  });

  it('refuses a branch it cannot read instead of passing silently', () => {
    expect(() =>
      parseRules("CASE WHEN x.status = 'completed' THEN x.amount ELSE 0 END")
    ).toThrow(/unparsed WHEN branch/);
    expect(() => parseRules('CASE ELSE 0 END')).toThrow();
  });
});

describe('safety gates are pinned at their enforcement statements', () => {
  const zero = normalizeSql(zeroSql);
  const list = normalizeSql(listSql);

  it.each([
    ['01-balance-list.sql', list, GATE_SHAPES.list],
    ['02-zero-out.sql', zero, GATE_SHAPES.zero],
  ] as const)('%s keeps every gate statement intact', (_n, text, fragments) => {
    expect(missing(text, fragments)).toEqual([]);
  });

  it('keeps the dry_run default and rejects the per-row NOT IN shortcut', () => {
    expect(stripComments(zeroSql)).toMatch(/\\set zero_out_mode dry_run/);
    expect(zero).not.toMatch(/customer_id NOT IN/i);
  });

  it('detects a gate whose raise or check was removed or loosened', () => {
    const gate = (frag: string) =>
      GATE_SHAPES.zero.find((f) => f.includes(frag)) as string;
    const customerGate = gate('customer_id AND c.merchant_id');
    const modeGate = gate('NOT IN');
    expect(
      zero.replace(
        customerGate,
        customerGate.replace('IF v_bad <> 0', 'IF false')
      )
    ).not.toContain(customerGate);
    expect(
      zero.replace("v_mode NOT IN ('dry_run', 'commit')", 'false')
    ).not.toContain(modeGate);
    expect(list.replace('AND c.id IS NOT NULL', '')).not.toContain(
      GATE_SHAPES.list[0]
    );
    expect(
      zero.replace('\\if :do_commit COMMIT;', '\\if :do_commit ROLLBACK;')
    ).not.toContain(gate('do_commit'));
  });

  it('compares the stored balance with the ledger total null-safely', () => {
    expect(list).toContain(
      'cw.available_balance IS NOT DISTINCT FROM COALESCE(l.ledger_balance, 0)'
    );
    expect(zero).toContain('l.expected_balance IS DISTINCT FROM (');
  });
});
