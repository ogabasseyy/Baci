import type {
  ApplyOperationInput,
  BuilderContext,
} from '@/lib/builder-connector/types';
import { builderReadyEditSchema } from '@/schemas/builder-edit-lease';
import { builderInputSchemas } from '@/schemas/builder-mcp';
import { builderDraftResultSchema } from '@/schemas/builder-mcp-results';
import { validateStoredCandidate } from './edit-candidate';
import { checkStore, editBinding, editResult, editRpc } from './edit-rpc';
export async function applyStorefrontOperation(
  ctx: BuilderContext,
  input: ApplyOperationInput
) {
  const binding = editBinding(ctx);
  const parsed = builderInputSchemas.apply_storefront_operation.parse(input);
  checkStore(ctx, parsed.storefrontId);
  const prepared = await editRpc(ctx, 'builder_prepare_apply', {
    ...binding,
    p_operation: parsed.operationId,
  });
  if (prepared !== null) {
    const ready = builderReadyEditSchema.parse(prepared);
    validateStoredCandidate(ready.sourceConfig, ready.candidate);
  }
  return editResult(
    builderDraftResultSchema,
    await editRpc(ctx, 'builder_apply_operation', {
      ...binding,
      p_operation: parsed.operationId,
      p_expected: parsed.expectedVersion.slice(6),
      p_retry_key: parsed.idempotencyKey,
    })
  );
}
