import type { PrerenderBinding } from '../../../tools/experience-runner/prerender-artifacts';
import { type ExperienceContext, ownerRpcArgs } from './authorization';
import { verifyCompiledCandidate } from './compiled-candidate';

/** Normal authenticated RPC. Only a missing legacy record may use disk fallback. */
export async function readVerifiedPrerender(
  ctx: ExperienceContext,
  binding: PrerenderBinding,
  signal?: AbortSignal
) {
  if (binding.merchantId !== ctx.merchantId) throw Error('NOT_FOUND');
  signal?.throwIfAborted();
  const query = ctx.supabase.rpc('experience_read_prerender_build', {
    ...ownerRpcArgs(ctx),
    p_build_id: binding.buildId,
    p_digest: binding.buildDigest,
    p_source: binding.sourceDigest,
  });
  const result = await (signal ? query.abortSignal(signal) : query);
  signal?.throwIfAborted();
  if (result.error) throw Error('RENDERER_UNAVAILABLE');
  return result.data === null ? null : verifyCompiledCandidate(result.data);
}
