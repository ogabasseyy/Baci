import { z } from 'zod';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { builderOperationResultSchema } from '@/schemas/builder-mcp-results';
import { editBinding, editRpc } from './edit-rpc';
export async function getStorefrontOperation(
  ctx: BuilderContext,
  operationId: string
) {
  return builderOperationResultSchema.parse(
    await editRpc(ctx, 'builder_get_operation', {
      ...editBinding(ctx, 'storefront.read'),
      p_operation: z.uuid().parse(operationId),
    })
  );
}
