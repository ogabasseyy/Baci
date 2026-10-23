import { z } from 'zod';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { builderEditLeaseSchema } from '@/schemas/builder-edit-lease';
import { editBinding, editRpc } from './edit-rpc';
export async function claimStorefrontEdit(
  ctx: BuilderContext,
  operationId: string
) {
  const value = await editRpc(ctx, 'builder_claim_edit', {
    ...editBinding(ctx),
    p_operation: z.uuid().parse(operationId),
  });
  return value === null ? null : builderEditLeaseSchema.parse(value);
}
