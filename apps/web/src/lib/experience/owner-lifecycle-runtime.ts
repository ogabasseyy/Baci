import type { SupabaseClient } from '@supabase/supabase-js';
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
    kind: 'draft' | 'lifecycle'
  ): Promise<void>;
  verifyCommitted(
    client: SupabaseClient,
    receipt: Record<string, unknown>
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
      confirm: async (client, id) => {
        const existing = await loadDraftApproval(client, id);
        if (existing.status === 'confirmation-required')
          await verifier.attest(client, id, 'draft');
        return confirmDraftApply(client, id);
      },
      confirmPublication: async (client, id) => {
        const existing = await loadLifecycleApproval(client, id);
        if (existing.status === 'confirmation-required')
          await verifier.attest(client, id, 'lifecycle');
        const receipt = await confirmExperiencePublication(client, id);
        if (receipt.status === 'verifying') {
          try {
            await verifier.verifyCommitted(client, {
              ...receipt,
              approvalId: id,
            });
          } catch {
            return receipt;
          }
          return loadLifecycleApproval(client, id);
        }
        return receipt;
      },
      confirmModeExit: async (client, id) => {
        const existing = await loadLifecycleApproval(client, id);
        if (existing.status === 'confirmation-required')
          await verifier.attest(client, id, 'lifecycle');
        return confirmExperienceModeExit(client, id);
      },
    },
  };
}
