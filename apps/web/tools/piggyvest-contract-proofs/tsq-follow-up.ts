/**
 * What to do after a transfer submit whose outcome is unknown (the response
 * was lost or timed out). The only safe move is a status check (TSQ) on the
 * SAME reference; the answer is one of four verdicts and none of them is a
 * resend. A 404 straight after submit may simply mean "not indexed yet", so it
 * is uncertain, exactly like a gateway error or a dropped connection.
 */

export type FollowUpVerdict = 'settled' | 'failed' | 'pending' | 'uncertain';

export interface FollowUp {
  verdict: FollowUpVerdict;
  /** True for HTTP 404 only. */
  notFound: boolean;
  /** Always false: a status reading never authorises sending the same transfer again. */
  resend: false;
}

const SETTLED = new Set(['success', 'successful']);

export function followUpAfterSubmit(status: string): FollowUp {
  const verdict: FollowUpVerdict = SETTLED.has(status)
    ? 'settled'
    : status === 'failed'
      ? 'failed'
      : status === 'pending'
        ? 'pending'
        : 'uncertain';
  return { verdict, notFound: status === 'http_404', resend: false };
}

export type Disposition =
  | 'settled'
  | 'failed_release_new_reference'
  | 'hold_for_reconcile';

/**
 * The outcome after the whole status-check budget. Only the LAST reading
 * counts: a transfer that read pending or unknown last is held for
 * reconciliation, never retried.
 */
export function disposition(verdicts: readonly FollowUpVerdict[]): Disposition {
  const last = verdicts.at(-1);
  if (last === 'settled') return 'settled';
  if (last === 'failed') return 'failed_release_new_reference';
  return 'hold_for_reconcile';
}
