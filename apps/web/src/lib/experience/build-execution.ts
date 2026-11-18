import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import { type ExperienceContext, ownerRpcArgs } from './authorization';
import { startBuildLeaseHeartbeat } from './build-lease-heartbeat';
import type { ExperienceBuildExecutor } from './local-build-supervisor-types';

export function bindBuildExecutor(
  run: ExperienceBuildExecutor = runLocalQualification,
  signal?: AbortSignal
): ExperienceBuildExecutor {
  return async (kind, payload) => {
    signal?.throwIfAborted();
    const result = await (signal && run.withSignal
      ? run.withSignal(kind, payload, signal)
      : run(kind, payload));
    signal?.throwIfAborted();
    return result;
  };
}

export function startLinkedBuildLease(
  ctx: ExperienceContext,
  job: { id: string; attempt_nonce: string }
) {
  if (!ctx.identity) return;
  return startBuildLeaseHeartbeat(
    async () => {
      const renewal = await ctx.supabase.rpc('experience_renew_build_lease', {
        ...ownerRpcArgs(ctx),
        p_job: job.id,
        p_attempt: job.attempt_nonce,
      });
      return !renewal.error && renewal.data === true;
    },
    undefined,
    undefined,
    ctx.signal
  );
}
