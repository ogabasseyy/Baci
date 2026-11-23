import type { SupabaseClient } from '@supabase/supabase-js';
import { createApprovalPreparation } from './approval-preparation';
import { confirmDraftApply, loadDraftApproval } from './approval-service';
import { confirmExperienceModeExit } from './mode-exit-service';
import type { ExperienceOwnerRuntime } from './owner-runtime';
import {
  confirmExperiencePublication,
  loadLifecycleApproval,
} from './publication-service';
/** Trusted independently isolated verifier only; never supplied by tool input. */
export interface OwnerLifecycleVerification {
  attest(
    client: SupabaseClient,
    approvalId: string,
    kind: 'draft' | 'lifecycle',
    signal?: AbortSignal
  ): Promise<void>;
  verifyCommitted(
    client: SupabaseClient,
    receipt: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void>;
}
export function createOwnerLifecycleRuntime(
  createPreviewLaunch: ExperienceOwnerRuntime['createPreviewLaunch'],
  verifier: OwnerLifecycleVerification
): ExperienceOwnerRuntime {
  return {
    createPreviewLaunch,
    approval: {
      load: loadDraftApproval,
      loadLifecycle: loadLifecycleApproval,
      prepareDraft: createApprovalPreparation(verifier.attest, 'draft'),
      preparePublication: createApprovalPreparation(
        verifier.attest,
        'lifecycle'
      ),
      confirm: confirmDraftApply,
      confirmPublication: async (client, id, signal) => {
        signal?.throwIfAborted();
        const receipt = await confirmExperiencePublication(client, id);
        if (receipt.status === 'verifying') {
          try {
            await verifier.verifyCommitted(
              client,
              {
                ...receipt,
                approvalId: id,
              },
              signal
            );
          } catch {
            return receipt;
          }
          return loadLifecycleApproval(client, id);
        }
        return receipt;
      },
      confirmModeExit: async (client, id, signal) => {
        const existing = await loadLifecycleApproval(client, id);
        if (existing.status === 'confirmation-required')
          await verifier.attest(client, id, 'lifecycle', signal);
        signal?.throwIfAborted();
        return confirmExperienceModeExit(client, id);
      },
    },
  };
}
