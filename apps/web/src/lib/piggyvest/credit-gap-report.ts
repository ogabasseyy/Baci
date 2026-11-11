import {
  type CreditGapFinding,
  type CreditGapReport,
  type CreditGapUnchecked,
  creditGapPages,
} from './credit-gap-reconciliation';
import type { ReconciliationReport } from './daily-reconciliation';
import { formatKobo } from './daily-reconciliation-report';

type CheckedReport = Exclude<ReconciliationReport, { status: 'failed' }>;

/** Adds the credit-gap section to a completed daily report. */
export function withCreditGap(
  report: CheckedReport,
  creditGap: CreditGapReport
): CheckedReport {
  if (!creditGapPages(creditGap)) return { ...report, creditGap };
  return {
    ...report,
    creditGap,
    status: 'attention',
    reasons: [...report.reasons, 'credit_gap'],
  };
}

const FINDING_TEXT: Record<CreditGapFinding['kind'], string> = {
  unrecorded_credit:
    'PiggyVest credited this wallet but we never recorded it. Replay the stored webhook capture, or repair it by hand',
  not_on_provider:
    'we recorded this inflow but PiggyVest does not list it for this wallet. Check it at PiggyVest before acting',
  interest_not_listed:
    'we recorded this interest payout but the transaction list does not show it (review only: the list may not include interest)',
};

const UNCHECKED_TEXT: Record<CreditGapUnchecked['reason'], string> = {
  list_unreadable: 'PiggyVest transaction list could not be read',
  list_incomplete:
    'PiggyVest transaction list could not be read to the start of the window',
  ledger_truncated: 'too many recorded credits to compare in one run',
  deadline: 'time ran out before it was read',
};

function findingLine(finding: CreditGapFinding): string {
  const amount =
    finding.amountKobo === null ? '' : `, ${formatKobo(finding.amountKobo)}`;
  const category = finding.category === null ? '' : ` (${finding.category})`;
  return `- ${finding.walletId}: ${finding.reference}${amount}${category} at ${finding.at}: ${FINDING_TEXT[finding.kind]}.`;
}

/** Email lines for the credit-gap section (empty when it did not run). */
export function creditGapLines(creditGap: CreditGapReport | undefined) {
  if (!creditGap) return [];
  if (creditGap.status === 'failed')
    return [
      '',
      `Missing-credit check FAILED (${creditGap.reason}): PiggyVest credits were not compared with our records today.`,
    ];
  const lines = [
    '',
    `Missing-credit check since ${creditGap.windowStart}: ${creditGap.walletsChecked} of ${creditGap.walletsTotal} wallet(s) compared.`,
  ];
  if (creditGap.findings.length === 0)
    lines.push('Every PiggyVest credit matches a recorded credit.');
  else lines.push(...creditGap.findings.map(findingLine));
  lines.push(
    ...creditGap.unchecked.map(
      (item) =>
        `- ${item.walletId}: NOT checked, ${UNCHECKED_TEXT[item.reason]}.`
    )
  );
  if (creditGap.walletsDeferred > 0)
    lines.push(
      `${creditGap.walletsDeferred} wallet(s) were not in today's window and will be checked on later runs.`
    );
  if (creditGap.internalSkipped > 0)
    lines.push(
      `${creditGap.internalSkipped} unrecorded wallet-to-wallet credit(s) were skipped: savings transfers are checked above.`
    );
  if (creditGap.unkeyed > 0)
    lines.push(
      `${creditGap.unkeyed} older recorded credit(s) have no PVB credit id and could not be matched.`
    );
  return lines;
}

/** The page-reason fragment for this section; empty when it needs no page. */
export function creditGapPageFragment(
  creditGap: CreditGapReport | undefined
): string {
  if (!creditGap || !creditGapPages(creditGap)) return '';
  if (creditGap.status === 'failed')
    return ` credit_gap=failed:${creditGap.reason}`;
  const count = (kind: CreditGapFinding['kind']) =>
    creditGap.findings.filter((finding) => finding.kind === kind).length;
  return ` unrecorded_credits=${count('unrecorded_credit')} not_on_provider=${count('not_on_provider')} credit_unchecked=${creditGap.unchecked.length}`;
}
