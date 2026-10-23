import type { BuilderContext } from '@/lib/builder-connector/types';
import {
  builderEditLeaseSchema,
  type EditLease,
} from '@/schemas/builder-edit-lease';
import { builderOperationResultSchema } from '@/schemas/builder-mcp-results';
import type { PortableHome } from '@/schemas/portable-storefront';
import { buildEditCandidate, validateEditSource } from './edit-candidate';
import { editBinding, editRpc } from './edit-rpc';
import { DraftServiceError } from './mutation-authorization';
export type EditGenerator = (input: {
  source: PortableHome;
  instructions: string;
  signal: AbortSignal;
}) => Promise<unknown>;
export interface EditRunDependencies {
  generate: EditGenerator;
  rateLimit: (identifier: string) => { allowed: boolean };
  now?: () => number;
  timeoutMs?: number;
}
/** Executed only by the fixed upstream-user endpoint, never by a status getter. */
export async function runStorefrontEdit(
  ctx: BuilderContext,
  input: EditLease,
  deps: EditRunDependencies
) {
  const binding = editBinding(ctx);
  const requested = builderEditLeaseSchema.parse(input);
  const now = deps.now ?? Date.now;
  const lease = builderEditLeaseSchema.parse(
    await editRpc(ctx, 'builder_load_edit_lease', {
      ...binding,
      p_operation: requested.operationId,
      p_lease: requested.leaseId,
    })
  );
  if (
    lease.connectionId !== ctx.identity.connectionId ||
    lease.grantVersion !== ctx.identity.grantVersion ||
    Date.parse(lease.leaseExpiresAt) <= now()
  )
    throw new DraftServiceError('OPERATION_FAILED');
  let outcome: 'ready' | 'failed' | 'transient' = 'failed';
  let candidate: PortableHome | null = null;
  try {
    const source = validateEditSource(lease.sourceConfig);
    if (!deps.rateLimit(`builder:${ctx.identity.actorUserId}`).allowed) {
      outcome = 'transient';
    } else {
      const signal = AbortSignal.timeout(
        Math.min(deps.timeoutMs ?? 24000, 24000)
      );
      const generated = await Promise.race([
        deps.generate({ source, instructions: lease.instructions, signal }),
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('Provider timeout')),
            { once: true }
          );
        }),
      ]);
      candidate = buildEditCandidate(source, generated);
      outcome = 'ready';
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    outcome =
      code === 'ai_provider_unavailable' ||
      code === 'ai_provider_rate_limited' ||
      (error instanceof Error && error.message === 'Provider timeout')
        ? 'transient'
        : 'failed';
  }
  // SQL rechecks canonical grant, source revision and current lease after generation.
  return builderOperationResultSchema.parse(
    await editRpc(ctx, 'builder_finish_edit', {
      ...binding,
      p_operation: lease.operationId,
      p_lease: lease.leaseId,
      p_outcome: outcome,
      p_candidate: candidate,
    })
  );
}
