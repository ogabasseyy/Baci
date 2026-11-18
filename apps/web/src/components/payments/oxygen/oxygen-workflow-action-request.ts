import { oxygenEligibilityProgressHeader } from '@baci/shared/oxygen';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenEligibilityReasonHeader } from '@/lib/payments/oxygen/eligibility-reason-contract';

export function sendOxygenWorkflowAction(body: string | FormData) {
  return fetchWithCsrf('/api/payments/oxygen/workflows/actions', {
    method: 'POST',
    body,
    cache: 'no-store',
    headers: {
      [oxygenEligibilityReasonHeader]: '1',
      [oxygenEligibilityProgressHeader]: '1',
    },
  });
}
