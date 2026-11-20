import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import { localPreviewHost } from '../../../tools/experience-runner/preview-origin';
import {
  type ExperienceContext,
  type OwnerRequestContext,
  ownerRpcArgs,
} from './authorization';
import { startBuildLeaseHeartbeat } from './build-lease-heartbeat';
import type {
  ExperienceBuildDependencies,
  ExperienceBuildExecutor,
} from './local-build-supervisor-types';
import { productionOrigin } from './production-origins';

export function resolveBuildHost(
  ctx: OwnerRequestContext,
  deps: ExperienceBuildDependencies
) {
  ctx.signal?.throwIfAborted();
  if (deps.profile !== 'production') {
    if (deps.previewOrigin) throw Error('INVALID_PREVIEW_ORIGIN');
    return localPreviewHost(deps.hostOrigin);
  }
  if (!ctx.identity) throw Error('BUILD_CONNECTION_REQUIRED');
  if (
    !deps.execute ||
    !deps.prerenderArtifacts ||
    typeof deps.bootstrap !== 'function'
  )
    throw Error('INCOMPLETE_PRODUCTION_BUILD');
  return productionOrigin(deps.hostOrigin);
}

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
