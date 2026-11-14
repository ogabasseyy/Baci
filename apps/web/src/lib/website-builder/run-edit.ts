import type { BuilderContext } from '@/lib/builder-connector/types';
import { admitLegacyExecution } from '@/lib/experience/legacy-execution';
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
      const acknowledge = await admitLegacyExecution(
        ctx.supabase,
        ctx.merchantId
      );
      const signal = AbortSignal.timeout(
        Math.min(deps.timeoutMs ?? 24000, 24000)
      );
      // Retain admission until the actual provider promise settles, even when
      // the outer deadline wins. A timeout is not cancellation acknowledgement.
      const provider = Promise.resolve().then(() =>
        deps.generate({ source, instructions: lease.instructions, signal })
      );
      const settled = provider.then(
        async (generated) => {
          await acknowledge();
          return generated;
        },
        async (error: unknown) => {
          await acknowledge();
          throw error;
        }
      );
      // Keep cleanup attached after a timeout. Successful generation waits for
      // its acknowledgement transaction before finish_edit.
      void settled.catch(() => undefined);
      const generated = await Promise.race([
        settled,
        new Promise<never>((_, reject) => {
          const expired = () => reject(new Error('Provider timeout'));
          if (signal.aborted) expired();
          else signal.addEventListener('abort', expired, { once: true });
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
