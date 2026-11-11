import { escapeHtmlText } from '@/lib/sanitize';
import { creditGapLines, creditGapPageFragment } from './credit-gap-report';
import type {
  BalanceFinding,
  ReconciliationReport,
  StuckFinding,
} from './daily-reconciliation';

/** Kobo as naira text, by integer math only (no float rounding). */
export function formatKobo(kobo: number): string {
  const sign = kobo < 0 ? '-' : '';
  const magnitude = Math.abs(kobo);
  const naira = Math.trunc(magnitude / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₦${naira}.${String(magnitude % 100).padStart(2, '0')}`;
}

const READING_TEXT: Record<StuckFinding['reading'], string> = {
  submitted:
    'PiggyVest says it completed, but our record is not settled (needs settling)',
  pending: 'PiggyVest says it is still pending',
  failed: 'PiggyVest says it failed (needs releasing)',
  not_found: 'PiggyVest does not list it yet (not proof it was never sent)',
  uncertain: 'PiggyVest status could not be confirmed',
  not_dispatched: 'reserved but never sent to PiggyVest',
};

// The transfer list is read from our records at snapshot time and PiggyVest
// minutes later, so a transfer may have settled or been released in between.
function stuckLine(item: StuckFinding): string {
  const minutes = Math.floor(item.ageSeconds / 60);
  return `- ${item.reference}: ${formatKobo(item.amountKobo)}, ${item.state} at snapshot time, for ${minutes} minutes. ${READING_TEXT[item.reading]}.`;
}

function balanceLine(item: BalanceFinding): string {
  if (item.kind === 'unreadable')
    return `- ${item.walletId}: PiggyVest balance could not be read (we recorded ${formatKobo(item.expectedKobo)}).`;
  const label = {
    match: 'matches',
    below_expected: 'BELOW what we recorded',
    above_expected:
      'above what we recorded (interest or an unrecorded credit, review)',
  }[item.kind];
  return `- ${item.walletId}: PiggyVest ${formatKobo(item.providerKobo ?? 0)} vs recorded ${formatKobo(item.expectedKobo)}, difference ${formatKobo(item.differenceKobo ?? 0)}, ${label}.`;
}

/** The report date in UTC, so a failed and a snapshot report agree. */
function dateOf(generatedAt: string): string {
  const time = Date.parse(generatedAt);
  return Number.isNaN(time)
    ? generatedAt.slice(0, 10)
    : new Date(time).toISOString().slice(0, 10);
}

export function renderReconciliationEmail(report: ReconciliationReport): {
  subject: string;
  text: string;
  html: string;
} {
  const date = dateOf(report.generatedAt);
  let headline: string;
  let lines: string[];
  if (report.status === 'failed') {
    headline = 'FAILED to run';
    lines = [
      'The daily reconciliation did not run to the end, so nothing was checked.',
      `Reason: ${report.reason}.`,
      'Treat today as unchecked until it is run again.',
    ];
  } else {
    const aboveRecord = report.balances.some(
      (balance) => balance.kind === 'above_expected'
    );
    const creditReview =
      report.creditGap?.status === 'checked' &&
      report.creditGap.findings.length > 0;
    if (report.status === 'attention') headline = 'NEEDS ATTENTION';
    else if (aboveRecord) headline = 'REVIEW balances above record';
    else if (creditReview) headline = 'REVIEW recorded interest payouts';
    else if (report.deferred.wallets > 0)
      headline = `all clear, ${report.deferred.wallets} wallet(s) deferred to later runs`;
    else headline = 'all clear';
    lines = [
      report.stuckTotal === 0
        ? `Nothing is stuck (transfers still reserved or sent after ${Math.floor(report.staleAfterSeconds / 60)} minutes).`
        : `${report.stuckTotal} transfer(s) stuck past ${Math.floor(report.staleAfterSeconds / 60)} minutes:`,
      ...report.stuck.map(stuckLine),
      '',
      `Goal wallet balances checked: ${report.balances.filter((balance) => balance.kind !== 'unreadable').length} of ${report.walletsTotal}.`,
      ...report.balances.map(balanceLine),
    ];
    if (report.deferred.stuck > 0)
      lines.push(
        '',
        `${report.deferred.stuck} stuck transfer(s) are not listed above; they rotate into view on later runs.`
      );
    if (report.deferred.wallets > 0)
      lines.push(
        '',
        `${report.deferred.wallets} wallet(s) were not in today's window and will be checked on later runs.`
      );
    lines.push(...creditGapLines(report.creditGap));
    if (report.deadlineReached)
      lines.push(
        '',
        'PiggyVest was too slow: the time allowed for reads ran out, so some transfers and balances below were NOT checked.'
      );
    lines.push(
      '',
      'This report only reads. Nothing was resent, settled or released.'
    );
  }
  const subject = `PiggyVest daily reconciliation: ${headline} (${date})`;
  const text = [subject, '', ...lines].join('\n');
  const html = `<h2>${escapeHtmlText(subject)}</h2>${lines
    .map((line) => (line === '' ? '<br>' : `<p>${escapeHtmlText(line)}</p>`))
    .join('')}`;
  return { subject, text, html };
}

/** The one-line reason sent with the page; null when no page is needed. */
export function pageReasonOf(report: ReconciliationReport): string | null {
  if (report.status === 'failed')
    return `reconciliation_failed:${report.reason}`;
  if (report.status === 'clean') return null;
  const count = (kind: BalanceFinding['kind']) =>
    report.balances.filter((balance) => balance.kind === kind).length;
  const deadline = report.deadlineReached ? ' deadline=reached' : '';
  return `stuck=${report.stuckTotal} below_expected=${count('below_expected')} unreadable=${count('unreadable')} truncated=${report.truncated.stuck ? 'yes' : 'no'}${creditGapPageFragment(report.creditGap)}${deadline}`;
}
