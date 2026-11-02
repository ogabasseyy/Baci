import { classifyOxygenEligibility } from '../../src/lib/payments/oxygen/eligibility';
import { parseBanks, record } from './diagnostics';
import { readEligibilityReport } from './eligibility-report';
import type { ProbeResult } from './session-types';

/** Handle read-only result presentation without changing session credentials. */
export function applyProbeReadResults(
  action: string,
  response: Pick<Response, 'ok' | 'status'>,
  data: unknown,
  workflowReference: string,
  partnerReference: string,
  result: ProbeResult
): ProbeResult | undefined {
  if (action === 'banks' && response.ok) {
    const banks = parseBanks(data);
    if (!banks)
      return { code: 'invalid_bank_response', status: response.status };
    result.banks = banks;
    result.code = 'banks_loaded';
  }
  if (action === 'name-enquiry' && response.ok) {
    const fields = record(data);
    if (
      fields.success === true &&
      fields.errorCode === 0 &&
      typeof fields.accountName === 'string' &&
      fields.accountName.trim().length > 0 &&
      fields.accountName.length <= 150
    ) {
      result.accountName = fields.accountName;
      result.code = 'account_name_resolved';
    } else result.code = 'account_name_unresolved';
  }
  if (action === 'eligibility') {
    result.decision =
      response.status === 200 || response.status === 400
        ? classifyOxygenEligibility(data)
        : { kind: 'unknown' };
    result.eligibilityReport = readEligibilityReport(
      data,
      response.status,
      workflowReference,
      partnerReference
    );
    if (result.eligibilityReport) result.code = 'eligibility_report_received';
  }
  if (action === 'selfie' && response.ok) {
    const url = record(data).url;
    if (typeof url === 'string') {
      try {
        const target = new URL(url);
        if (
          target.protocol === 'https:' &&
          !target.username &&
          !target.password
        ) {
          result.url = target.href;
          result.code = 'selfie_link_ready';
        }
      } catch {
        /* No untrusted URL is opened. */
      }
    }
  }
}
