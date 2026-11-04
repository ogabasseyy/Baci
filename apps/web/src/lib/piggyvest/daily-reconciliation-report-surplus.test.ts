import { describe, expect, it } from 'vitest';
import type { ReconciliationReport } from './daily-reconciliation';
import {
  pageReasonOf,
  renderReconciliationEmail,
} from './daily-reconciliation-report';

const base: {
  generatedAt: string;
  staleAfterSeconds: number;
  stuckTotal: number;
  stuck: [];
  walletsTotal: number;
  truncated: { stuck: boolean; wallets: boolean };
  deferred: { stuck: number; wallets: number };
} = {
  generatedAt: '2026-11-03T00:30:00.000+01:00',
  staleAfterSeconds: 1800,
  stuckTotal: 0,
  stuck: [],
  walletsTotal: 1,
  truncated: { stuck: false, wallets: false },
  deferred: { stuck: 0, wallets: 0 },
};

const huge: ReconciliationReport = {
  ...base,
  status: 'clean',
  balances: [
    {
      walletId: 'goal-a',
      expectedKobo: 150000,
      providerKobo: 99_950_000,
      differenceKobo: 99_800_000,
      kind: 'above_expected',
    },
  ],
  reasons: [],
};

describe('a surplus is a review line, never a page', () => {
  it('sends no page reason however large the surplus is', () => {
    expect(pageReasonOf(huge)).toBeNull();
  });

  it('says REVIEW, not NEEDS ATTENTION, and shows the amount', () => {
    const { subject, text } = renderReconciliationEmail(huge);
    expect(subject).toContain('REVIEW balances above record');
    expect(subject).not.toContain('NEEDS ATTENTION');
    expect(text).toContain('₦998,000.00');
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
