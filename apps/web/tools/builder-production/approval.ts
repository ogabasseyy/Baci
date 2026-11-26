import { createApprovalPreparation } from '@/lib/experience/approval-preparation';
import {
  confirmDraftApply,
  loadDraftApproval,
} from '@/lib/experience/approval-service';
import type { OwnerLifecycleVerification } from '@/lib/experience/owner-lifecycle-runtime';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';

/** No public pointer mutation until the independent public verifier is installed. */
export function createBuilderDraftApproval(
  attest: OwnerLifecycleVerification['attest']
) {
  const unavailable = () =>
    Promise.reject(Error('PUBLIC_VERIFIER_NOT_INSTALLED'));
  return {
    load: loadDraftApproval,
    loadLifecycle: loadLifecycleApproval,
    prepareDraft: createApprovalPreparation(attest, 'draft'),
    confirm: confirmDraftApply,
    confirmPublication: unavailable,
    confirmModeExit: unavailable,
  };
}
