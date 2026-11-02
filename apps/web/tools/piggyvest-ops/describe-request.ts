import type { OpsOpenRequest } from '@/schemas/piggyvest/ops-open-request-row';
import { formatNaira } from './format-naira';
import { sanitizeForTerminal } from './sanitize-for-terminal';

const REQUIRED_APPROVALS = 2;

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
