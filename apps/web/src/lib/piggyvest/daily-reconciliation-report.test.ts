import { describe, expect, it } from 'vitest';
import type { ReconciliationReport } from './daily-reconciliation';
import {
  formatKobo,
  pageReasonOf,
  renderReconciliationEmail,
} from './daily-reconciliation-report';

const clean: ReconciliationReport = {
  status: 'clean',
  generatedAt: '2026-11-03T01:29:30.079678+01:00',
  staleAfterSeconds: 1800,
  stuckTotal: 0,
  stuck: [],
  walletsTotal: 1,
  balances: [
    {
      walletId: 'goal-a',
      expectedKobo: 150000,
      providerKobo: 150000,
      differenceKobo: 0,
      kind: 'match',
    },
  ],
  truncated: { stuck: false, wallets: false },
  reasons: [],
};
const attention: ReconciliationReport = {
  ...clean,
  status: 'attention',
  stuckTotal: 1,
  stuck: [
    {
      operationId: '00000000-0000-4000-8000-0000000000a3',
      reference: 'ref-<b>x</b>',
      state: 'dispatched',
      amountKobo: 70000,
      ageSeconds: 5400,
      reading: 'pending',
    },
  ],
  balances: [
    {
      walletId: 'goal-a',
      expectedKobo: 150000,
      providerKobo: 100050,
      differenceKobo: -49950,
      kind: 'below_expected',
    },
    {
      walletId: 'goal-b',
      expectedKobo: 1,
      providerKobo: null,
      differenceKobo: null,
      kind: 'unreadable',
    },
  ],
  reasons: ['stuck_transfers', 'balance_below_expected', 'balance_unreadable'],
};

describe('formatKobo', () => {
  it.each([
    [0, '₦0.00'],
    [5, '₦0.05'],
    [150000, '₦1,500.00'],
    [-49950, '-₦499.50'],
    [9999999999, '₦99,999,999.99'],
  ])('formats %i', (kobo, text) => {
    expect(formatKobo(kobo)).toBe(text);
  });
});

describe('renderReconciliationEmail', () => {
  it('says all clear in the subject and lists the checked wallet', () => {
    const email = renderReconciliationEmail(clean);
    expect(email.subject).toBe(
      'PiggyVest daily reconciliation: all clear (2026-11-03)'
    );
    expect(email.text).toContain('Nothing is stuck');
    expect(email.text).toContain('goal-a');
  });

  it('flags attention with stuck transfers and the balance differences', () => {
    const email = renderReconciliationEmail(attention);
    expect(email.subject).toBe(
      'PiggyVest daily reconciliation: NEEDS ATTENTION (2026-11-03)'
    );
    expect(email.text).toContain('pending');
    expect(email.text).toContain('90 minutes');
    expect(email.text).toContain('-₦499.50');
    expect(email.text).toContain('could not be read');
  });

  it('escapes provider-influenced text in the html body', () => {
    const email = renderReconciliationEmail(attention);
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('ref-&lt;b&gt;x&lt;/b&gt;');
  });

  it('renders a failed run as a failure, never as clear', () => {
    const email = renderReconciliationEmail({
      status: 'failed',
      reason: 'snapshot_unavailable',
      generatedAt: '2026-11-03T00:30:00.000Z',
    });
    expect(email.subject).toBe(
      'PiggyVest daily reconciliation: FAILED to run (2026-11-03)'
    );
    expect(email.text).toContain('did not run');
    expect(email.text).not.toContain('all clear');
  });

  it('never prints a secret-looking value: only ids already in the report', () => {
    const email = renderReconciliationEmail(attention);
    expect(email.text).not.toMatch(/token|secret|password/i);
  });
});

describe('pageReasonOf', () => {
  it('is null when clean, and a short count line otherwise', () => {
    expect(pageReasonOf(clean)).toBeNull();
    expect(pageReasonOf(attention)).toBe(
      'stuck=1 below_expected=1 unreadable=1 truncated=no'
    );
    expect(
      pageReasonOf({
        status: 'failed',
        reason: 'snapshot_invalid',
        generatedAt: 'x',
      })
    ).toBe('reconciliation_failed:snapshot_invalid');
  });
});
