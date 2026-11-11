import { describe, expect, it } from 'vitest';
import type { CreditGapReport } from './credit-gap-reconciliation';
import {
  creditGapLines,
  creditGapPageFragment,
  withCreditGap,
} from './credit-gap-report';
import type { ReconciliationReport } from './daily-reconciliation';

type CheckedReport = Exclude<ReconciliationReport, { status: 'failed' }>;

const cleanReport: CheckedReport = {
  status: 'clean',
  generatedAt: '2026-11-11T23:00:00.000Z',
  staleAfterSeconds: 900,
  stuckTotal: 0,
  stuck: [],
  walletsTotal: 1,
  balances: [],
  truncated: { stuck: false, wallets: false },
  deferred: { stuck: 0, wallets: 0 },
  reasons: [],
};

function checked(overrides: Partial<CreditGapReport> = {}): CreditGapReport {
  return {
    status: 'checked',
    windowStart: '2026-11-08T23:00:00.000Z',
    walletsTotal: 1,
    walletsChecked: 1,
    walletsDeferred: 0,
    findings: [],
    unchecked: [],
    internalSkipped: 0,
    unkeyed: 0,
    ...overrides,
  } as CreditGapReport;
}

const missing = {
  walletId: 'plan-wallet-a',
  reference: 'PVB01MISSING000000000000001',
  kind: 'unrecorded_credit' as const,
  amountKobo: 250000,
  category: 'bank-inflow',
  at: '2026-11-10T12:00:00.000Z',
};

describe('withCreditGap', () => {
  it('keeps a clean report clean when the section needs no page', () => {
    const report = withCreditGap(cleanReport, checked());
    expect(report).toMatchObject({ status: 'clean', reasons: [] });
    expect(report.creditGap).toEqual(checked());
  });

  it('marks the report for attention when a credit is missing', () => {
    const report = withCreditGap(cleanReport, checked({ findings: [missing] }));
    expect(report).toMatchObject({
      status: 'attention',
      reasons: ['credit_gap'],
    });
  });

  it('marks the report for attention when the check failed', () => {
    const report = withCreditGap(cleanReport, {
      status: 'failed',
      reason: 'snapshot_invalid',
    });
    expect(report.status).toBe('attention');
  });
});

describe('creditGapLines', () => {
  it('returns nothing when the section did not run', () => {
    expect(creditGapLines(undefined)).toEqual([]);
  });

  it('says the check failed and why', () => {
    expect(
      creditGapLines({ status: 'failed', reason: 'snapshot_unavailable' }).join(
        '\n'
      )
    ).toContain('Missing-credit check FAILED (snapshot_unavailable)');
  });

  it('names a missing credit with its amount and every unchecked wallet', () => {
    const text = creditGapLines(
      checked({
        walletsTotal: 3,
        walletsDeferred: 1,
        findings: [missing],
        unchecked: [{ walletId: 'plan-wallet-b', reason: 'deadline' }],
        internalSkipped: 2,
        unkeyed: 4,
      })
    ).join('\n');

    expect(text).toContain(
      'plan-wallet-a: PVB01MISSING000000000000001, ₦2,500.00 (bank-inflow)'
    );
    expect(text).toContain(
      'plan-wallet-b: NOT checked, time ran out before it was read.'
    );
    expect(text).toContain('1 wallet(s) were not in today');
    expect(text).toContain('2 unrecorded wallet-to-wallet credit(s)');
    expect(text).toContain('4 older recorded credit(s) have no PVB credit id');
  });

  it('says every credit matched when there are no findings', () => {
    expect(creditGapLines(checked()).join('\n')).toContain(
      'Every PiggyVest credit matches a recorded credit.'
    );
  });
});

describe('creditGapPageFragment', () => {
  it('is empty when the section needs no page', () => {
    expect(creditGapPageFragment(undefined)).toBe('');
    expect(
      creditGapPageFragment(
        checked({
          findings: [
            { ...missing, kind: 'interest_not_listed' },
            { ...missing, kind: 'partial_credit' },
          ],
        })
      )
    ).toBe('');
  });

  it('counts missing credits and unchecked wallets', () => {
    expect(
      creditGapPageFragment(
        checked({
          findings: [missing, { ...missing, kind: 'not_on_provider' }],
          unchecked: [{ walletId: 'plan-wallet-b', reason: 'list_unreadable' }],
        })
      )
    ).toBe(' unrecorded_credits=1 not_on_provider=1 credit_unchecked=1');
  });

  it('names the failure reason', () => {
    expect(
      creditGapPageFragment({ status: 'failed', reason: 'snapshot_invalid' })
    ).toBe(' credit_gap=failed:snapshot_invalid');
  });
});
