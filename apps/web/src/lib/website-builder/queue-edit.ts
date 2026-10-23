import type {
  BuilderContext,
  UpdateDraftInput,
} from '@/lib/builder-connector/types';
import { builderInputSchemas } from '@/schemas/builder-mcp';
import { builderQueuedEditResultSchema } from '@/schemas/builder-mcp-results';
import { checkStore, editBinding, editResult, editRpc } from './edit-rpc';
export async function queueStorefrontEdit(
  ctx: BuilderContext,
  input: UpdateDraftInput
) {
  const binding = editBinding(ctx);
  const parsed = builderInputSchemas.update_storefront_draft.parse(input);
  checkStore(ctx, parsed.storefrontId);
  return editResult(
    builderQueuedEditResultSchema,
    await editRpc(ctx, 'builder_queue_edit', {
      ...binding,
      p_expected: parsed.expectedVersion.slice(6),
      p_retry_key: parsed.idempotencyKey,
      p_instructions: parsed.instructions,
    })
  );
}
