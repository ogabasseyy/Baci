import { experienceFinalizeInput } from '@/schemas/experience-job';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import {
  type CompiledCandidate,
  verifyCompiledCandidate,
} from './build-service';
import { digestBytes } from './manifest-digest';
export function verifyIndependentBuilds(
  a: unknown,
  b: unknown,
  render: unknown
) {
  const first = verifyCompiledCandidate(a);
  const second = verifyCompiledCandidate(b);
  if (
    first.digest !== second.digest ||
    first.hostOrigin !== second.hostOrigin ||
    JSON.stringify(first.imports) !== JSON.stringify(second.imports) ||
    !render ||
    typeof render !== 'object' ||
    !('status' in render) ||
    render.status !== 'passed'
  )
    throw Error('BUILD_FAILED');
  return first;
}
/** Only trusted composition receives verified bytes. This is not an HTTP payload type. */
export interface AcceptedPrivateBuild {
  jobId: string;
  attemptNonce: string;
  sourceDigest: string;
  candidate: CompiledCandidate;
  receiptDigest: string;
}
export async function finalizeExperienceBuild(
  inputCtx: OwnerRequestContext,
  input: unknown,
  accepted: AcceptedPrivateBuild
) {
  const v = experienceFinalizeInput.parse(input);
  const ctx = await requireExperienceOwner(inputCtx);
  if (v.jobId !== accepted.jobId) throw Error('BUILD_FAILED');
  const c = verifyCompiledCandidate(accepted.candidate);
  const files = [
    {
      path: 'app.js',
      mime: 'text/javascript',
      bytes: Buffer.from(c.javascript).toString('hex'),
      digest: digestBytes(c.javascript),
    },
    {
      path: 'app.css',
      mime: 'text/css',
      bytes: Buffer.from(c.css).toString('hex'),
      digest: digestBytes(c.css),
    },
  ];
  const r = await ctx.supabase.rpc('experience_finalize_build', {
    ...ownerRpcArgs(ctx),
    p_job: v.jobId,
    p_attempt: accepted.attemptNonce,
    p_source: accepted.sourceDigest,
    p_build: c.digest,
    p_receipt: accepted.receiptDigest,
    p_retry: v.idempotencyKey,
    p_files: files,
    p_host_origin: c.hostOrigin,
  });
  if (r.error || typeof r.data !== 'string') throw Error('BUILD_FAILED');
  return { buildId: r.data, buildDigest: c.digest };
}

/** Task5 durable staging implementation; current-publication delivery belongs to Task12. */
export const stageVerifiedBuild = finalizeExperienceBuild;
