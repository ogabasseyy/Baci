import { describe, expect, it } from 'vitest';
import type { ReconciliationReport } from './daily-reconciliation';
import {
  pageReasonOf,
  renderReconciliationEmail,
} from './daily-reconciliation-report';

const base = {
  generatedAt: '2026-11-03T00:30:00.000+01:00',
  staleAfterSeconds: 1800,
  stuckTotal: 0,
  stuck: [],
  walletsTotal: 1,
  truncated: { stuck: false, wallets: false },
} as const;

const large: ReconciliationReport = {
  ...base,
  status: 'attention',
  balances: [
    {
      walletId: 'goal-a',
      expectedKobo: 150000,
      providerKobo: 350000,
      differenceKobo: 200000,
      kind: 'above_expected_large',
    },
  ],
  reasons: ['balance_surplus_large'],
};

describe('large surplus in the report', () => {
  it('adds the surplus count to the page reason', () => {
    expect(pageReasonOf(large)).toBe(
      'stuck=0 below_expected=0 unreadable=0 truncated=no surplus_large=1'
    );
  });

  it('says NEEDS ATTENTION and explains the line', () => {
    const { subject, text } = renderReconciliationEmail(large);
    expect(subject).toContain('NEEDS ATTENTION');
    expect(text).toContain('LARGE surplus');
    expect(text).toContain('₦2,000.00');
  });
});

describe('report date', () => {
  it('dates a failed report and a snapshot report on the same (UTC) day', () => {
    const failed = renderReconciliationEmail({
      status: 'failed',
      reason: 'run_failed',
      generatedAt: '2026-11-02T23:45:00.000Z',
    });
    const ok = renderReconciliationEmail({
      ...base,
      status: 'clean',
      generatedAt: '2026-11-03T00:45:00.000+01:00',
      balances: [],
      reasons: [],
    });
    expect(failed.subject).toContain('(2026-11-02)');
    expect(ok.subject).toContain('(2026-11-02)');
  });

  it('falls back to the leading date text for an unparseable stamp', () => {
    const { subject } = renderReconciliationEmail({
      status: 'failed',
      reason: 'run_failed',
      generatedAt: '2026-11-02 garbled',
    });
    expect(subject).toContain('(2026-11-02)');
  });
});
