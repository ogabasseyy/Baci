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
  deferred: { stuck: 0, wallets: 0 },
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

  it('never says all clear when a wallet holds more than recorded', () => {
    const email = renderReconciliationEmail({
      ...clean,
      balances: [
        {
          walletId: 'goal-a',
          expectedKobo: 150000,
          providerKobo: 200000,
          differenceKobo: 50000,
          kind: 'above_expected',
        },
      ],
    });
    expect(email.subject).toBe(
      'PiggyVest daily reconciliation: REVIEW balances above record (2026-11-03)'
    );
    expect(email.text).not.toContain('all clear');
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

  it('says how many wallets were deferred to later runs, and is not a plain all clear', () => {
    const email = renderReconciliationEmail({
      ...clean,
      walletsTotal: 601,
      truncated: { stuck: false, wallets: true },
      deferred: { stuck: 0, wallets: 600 },
    });
    expect(email.subject).toBe(
      'PiggyVest daily reconciliation: all clear, 600 wallet(s) deferred to later runs (2026-11-03)'
    );
    expect(email.text).toContain(
      "600 wallet(s) were not in today's window and will be checked on later runs."
    );
  });

  it('says how many stuck transfers are not listed', () => {
    const email = renderReconciliationEmail({
      ...attention,
      stuckTotal: 250,
      truncated: { stuck: true, wallets: false },
      deferred: { stuck: 249, wallets: 0 },
    });
    expect(email.text).toContain(
      '249 stuck transfer(s) are not listed above; they rotate into view on later runs.'
    );
  });

  it('escapes provider-influenced text in the html body', () => {
    const email = renderReconciliationEmail(attention);
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('ref-&lt;b&gt;x&lt;/b&gt;');
  });

  it('escapes ampersands in the html body', () => {
    const email = renderReconciliationEmail({
      ...attention,
      stuck: [{ ...attention.stuck[0], reference: 'a&b' }],
    });
    expect(email.html).toContain('a&amp;b');
    expect(email.html).not.toContain('a&b:');
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
  it('does not page for deferred wallets alone', () => {
    expect(
      pageReasonOf({
        ...clean,
        walletsTotal: 601,
        truncated: { stuck: false, wallets: true },
        deferred: { stuck: 0, wallets: 600 },
      })
    ).toBeNull();
  });

  it('says so when the read budget ran out', () => {
    const cutOff = { ...attention, deadlineReached: true as const };
    expect(pageReasonOf(cutOff)).toBe(
      'stuck=1 below_expected=1 unreadable=1 truncated=no deadline=reached'
    );
    expect(renderReconciliationEmail(cutOff).text).toContain('NOT checked');
  });

  it('counts only wallets whose balance was actually read as checked', () => {
    const unread = (n: number) => ({
      walletId: `goal-${n}`,
      expectedKobo: 1,
      providerKobo: null,
      differenceKobo: null,
      kind: 'unreadable' as const,
    });
    const email = renderReconciliationEmail({
      ...attention,
      walletsTotal: 3,
      balances: [clean.balances[0] as never, unread(1), unread(2)],
      deadlineReached: true as const,
    });
    expect(email.text).toContain('Goal wallet balances checked: 1 of 3.');
  });
});
