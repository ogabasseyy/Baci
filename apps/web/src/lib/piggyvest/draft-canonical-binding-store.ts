import 'server-only';
import { piggyvestDraftCanonicalBindingSchemas as schemas } from '@/schemas/piggyvest-draft-canonical-binding';
import { DRAFT_CANONICAL_BINDING_STATEMENTS } from './draft-canonical-binding-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createDraftCanonicalBindingStore(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const parsed = schemas.configuration.safeParse(options.configuration);
  if (!parsed.success || typeof options.execute !== 'function')
    throw new Error('Draft binding unavailable');
  const config = parsed.data;
  return {
    async bind(input: unknown) {
      try {
        const selection = schemas.selection.parse(input);
        const result = await options.execute(
          DRAFT_CANONICAL_BINDING_STATEMENTS.bindCanonicalDraft.text,
          [
            config.integrationId,
            config.merchantId,
            config.customerId,
            config.goalId,
            config.expectedBusinessId,
            config.actorId,
            selection.draftId,
            selection.draftRevisionId,
            selection.policyRevisionId,
          ]
        );
        const receipt = schemas.result.parse(result.rows)[0].result;
        if (
          receipt.goalId !== config.goalId ||
          receipt.draftId !== selection.draftId ||
          receipt.draftRevisionId !== selection.draftRevisionId ||
          receipt.policyRevisionId !== selection.policyRevisionId
        )
          throw new Error('Receipt mismatch');
        return receipt;
      } catch {
        throw new Error('Draft binding unavailable');
      }
    },
  };
}
