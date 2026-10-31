import type { OpsOpenRequest } from '@/schemas/piggyvest/ops-approvals';

const REQUIRED_APPROVALS = 2;

/** Integer kobo to "₦1,234,567.89" without floating point. */
export function formatNaira(amountKobo: number): string {
  const naira = Math.trunc(amountKobo / 100);
  const kobo = amountKobo % 100;
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${grouped}.${kobo.toString().padStart(2, '0')}`;
}

/**
 * Reads what the approver retyped. Accepts an optional ₦, correctly placed
 * thousands commas and up to two decimals; anything else is refused (null).
 */
export function parseNairaInput(text: string): number | null {
  const match =
    /^₦?((?:[1-9][0-9]{0,2}(?:,[0-9]{3})+)|(?:0|[1-9][0-9]*))(?:\.([0-9]{1,2}))?$/.exec(
      text.trim()
    );
  if (!match) return null;
  const naira = Number(match[1].replaceAll(',', ''));
  const kobo = Number((match[2] ?? '').padEnd(2, '0'));
  const total = naira * 100 + kobo;
  return Number.isSafeInteger(total) ? total : null;
}

/** Removes control, escape and invisible formatting characters before display. */
export function sanitizeForTerminal(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '');
}

/** The summary an approver reads before retyping the amount. */
export function describeRequest(request: OpsOpenRequest): string[] {
  const clean = sanitizeForTerminal;
  return [
    `Request      ${request.requestId}`,
    `Action       ${clean(request.label)}`,
    `Amount       ${formatNaira(request.amountKobo)}`,
    `Destination  ${clean(request.destination)}`,
    `Reason       ${clean(request.reason ?? '(none given)')}`,
    `Requested by ${clean(request.requestedBy)}`,
    `Subject      ${clean(request.subject)}`,
    `Approvals    ${request.approvals} of ${REQUIRED_APPROVALS}`,
    `Expires      ${request.expiresAt.toISOString()}`,
    `Check code   ${request.digest.slice(0, 12)}`,
  ];
}

const REFUSALS: Record<string, string> = {
  ops_approval_not_an_approver:
    'This login is not an approver login. Use your own approver login, which must hold the approver role and no other role.',
  ops_approval_requester_cannot_approve:
    'You opened this request, so you cannot decide it. Two other approvers must.',
  ops_approval_already_decided: 'You have already decided this request.',
  ops_approval_closed:
    'This request is already closed (rejected, used or replaced).',
  ops_approval_expired:
    'This request has expired. Ask for a new request to be opened.',
  ops_approval_missing: 'This request does not exist.',
  ops_approval_confirmation_mismatch:
    'The request changed since it was listed. List again and re-check it.',
  ops_approval_invalid_decision: 'The decision must be approve or reject.',
};

export function refusalMessage(code: string): string {
  return (
    REFUSALS[code] ??
    'The database refused this decision. Nothing was recorded.'
  );
}
