import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  type ExperienceToolResult,
  experienceError,
  experienceErrorCode,
  experiencePerformanceBudgetError,
  experiencePerformanceQualificationError,
  experienceToolResult,
} from '@/schemas/experience-tool-results';
import {
  type ExperienceToolName,
  experienceToolInputs,
} from '@/schemas/experience-tools';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { queueExperienceBuild, readExperienceOperation } from './build-service';
import {
  CandidatePerformanceBudgetError,
  EXPERIENCE_STARTER_PERFORMANCE_BUDGET,
} from './candidate-performance-budget';
import {
  CandidatePerformanceQualificationError,
  EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY,
} from './candidate-performance-qualification';
import { requestDraftApply } from './draft-apply';
import {
  type PerformanceReader,
  readExperiencePerformance,
} from './performance-read';
import { requestExperiencePublication } from './publication-service';
import { requestExperienceRollback } from './rollback-service';
import { adoptSourceCandidate } from './source-candidate';
import { patchSource, readSource } from './source-service';
import { experienceToolPolicy } from './tool-policy';
import { beginUpload, finalizeUpload, writeChunk } from './upload-service';
export interface ExperienceDispatcherDependencies {
  rendering?: 'client' | 'prerender-private';
  backgroundBuilds?: boolean;
  readPerformance?: PerformanceReader;
  resolveUserClient(identity: BuilderIdentity): Promise<SupabaseClient>;
  finalizeBuild(
    ctx: OwnerRequestContext,
    input: { jobId: string; idempotencyKey: string }
  ): Promise<{ buildId: string; buildDigest: string }>;
  preview(
    ctx: OwnerRequestContext,
    input: { buildId: string; routeId: string; idempotencyKey: string }
  ): Promise<{
    evidenceId: string;
    buildId: string;
    buildDigest: string;
    previewUrl: string;
  }>;
}
export function createExperienceToolDispatcher(
  deps: ExperienceDispatcherDependencies
) {
  return async (
    identity: BuilderIdentity,
    name: ExperienceToolName,
    raw: unknown
  ): Promise<ExperienceToolResult> => {
    try {
      const parsed = experienceToolInputs[name].parse(raw);
      const policy = experienceToolPolicy[name];
      if (policy.scopes.some((s) => !identity.scopes.has(s)))
        return experienceError('INSUFFICIENT_SCOPE');
      if (!identity.allowedMerchantIds.includes(parsed.storefrontId))
        return experienceError('NOT_FOUND');
      const client = await deps.resolveUserClient(identity);
      const { data, error } = await client
        .from('merchants')
        .select('id,user_id')
        .eq('id', parsed.storefrontId)
        .eq('user_id', identity.actorUserId)
        .maybeSingle();
      if (error || !data || data.user_id !== identity.actorUserId)
        return experienceError('NOT_FOUND');
      const ctx = await requireExperienceOwner(
        { supabase: client, merchantId: data.id, identity },
        policy.scopes.includes('storefront.write')
          ? 'storefront.write'
          : policy.scopes.includes('storefront.publish')
            ? 'storefront.publish'
            : 'storefront.read'
      );
      const result = await execute(ctx, name, raw, deps);
      const safe = experienceToolResult.parse({ status: 'ok', value: result });
      return Buffer.byteLength(JSON.stringify(safe)) <= 98304
        ? safe
        : experienceError('QUOTA_EXCEEDED');
    } catch (e) {
      if (e instanceof z.ZodError) return experienceError('INVALID_REQUEST');
      if (e instanceof CandidatePerformanceBudgetError)
        return experiencePerformanceBudgetError(e.resource);
      if (e instanceof CandidatePerformanceQualificationError)
        return experiencePerformanceQualificationError(e.reason);
      const code = experienceErrorCode.safeParse(
        e instanceof Error ? e.message : null
      );
      return experienceError(
        code.success &&
          code.data !== 'PERFORMANCE_BUDGET_EXCEEDED' &&
          code.data !== 'PERFORMANCE_NOT_QUALIFIED'
          ? code.data
          : 'UNAVAILABLE'
      );
    }
  };
}
async function execute(
  ctx: OwnerRequestContext,
  name: ExperienceToolName,
  raw: unknown,
  deps: ExperienceDispatcherDependencies
): Promise<unknown> {
  switch (name) {
    case 'get_experience_capabilities':
      return {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        ownerOnly: true,
        maxSourceBytes: 4194304,
        maxChunkBytes: 32768,
        mode: 'full-custom-code',
        aiProviderCalls: 0,
        performance: {
          evidenceTool: 'read_experience_performance',
          authoringRequirements: [
            'Keep initial server and browser renders deterministic; use effects for browser-only state.',
            'Reserve image, media and asynchronous section dimensions at every viewport width.',
            'Make the actual hero discoverable in initial HTML; avoid lazy-loading above-the-fold media.',
            'Keep fonts and optional interactions from blocking initial content; respect the starter byte budgets.',
            'The platform owns React commit readiness; never spoof readiness markers or remove the initial inert boundary.',
            'Validate every declared route family on mobile and desktop; a passing example does not qualify future builds.',
          ],
          starterBudget: EXPERIENCE_STARTER_PERFORMANCE_BUDGET,
          qualificationPolicyId: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id,
          routeCoverage: 'one-representative-per-declared-route-family',
          qualificationWidths:
            EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.widths,
          coldSamplesPerRouteWidth:
            EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.coldSamplesPerCell,
          lcpTargetMs: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.lcpTargetMs,
          lcpStatistic: 'median-per-route-and-width',
          inpTargetMs: 200,
          clsTarget: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.maxCls,
          runtimeRendering: deps.rendering ?? 'client',
          prerenderStatus:
            deps.rendering === 'prerender-private'
              ? 'private-preview-enabled'
              : 'local-prototype',
          fieldQualification: 'not-established',
          productionQualification: 'not-established',
        },
      };
    case 'read_experience': {
      const {
        storefrontId: _,
        operation,
        ...v
      } = experienceToolInputs.read_experience.parse(raw);
      return operation === 'read'
        ? readSource(ctx, v as Parameters<typeof readSource>[1])
        : operation === 'adopt-upload'
          ? adoptSourceCandidate(ctx, v)
          : patchSource(ctx, v);
    }
    case 'begin_experience_upload': {
      const v = experienceToolInputs.begin_experience_upload.parse(raw);
      return beginUpload(ctx, { manifest: v.manifest, files: v.files });
    }
    case 'write_experience_chunk': {
      const {
        storefrontId: _,
        bytesBase64,
        ...v
      } = experienceToolInputs.write_experience_chunk.parse(raw);
      const bytes = Buffer.from(bytesBase64, 'base64');
      if (bytes.length > 32768 || bytes.toString('base64') !== bytesBase64)
        throw Error('INVALID_REQUEST');
      return writeChunk(ctx, { ...v, bytes });
    }
    case 'finalize_experience_upload':
      return finalizeUpload(
        ctx,
        experienceToolInputs.finalize_experience_upload.parse(raw)
      );
    case 'build_experience': {
      const { storefrontId: _, ...v } =
        experienceToolInputs.build_experience.parse(raw);
      return queueExperienceBuild(ctx, v);
    }
    case 'read_experience_performance':
      return readExperiencePerformance(
        ctx,
        experienceToolInputs.read_experience_performance.parse(raw).buildId,
        deps.readPerformance
      );
    case 'get_experience_operation':
      return readExperienceOperation(
        ctx,
        experienceToolInputs.get_experience_operation.parse(raw).jobId
      );
    case 'finalize_experience_build': {
      const { storefrontId: _, ...input } =
        experienceToolInputs.finalize_experience_build.parse(raw);
      if (deps.backgroundBuilds)
        return readExperienceOperation(ctx, input.jobId);
      return deps.finalizeBuild(ctx, input);
    }
    case 'preview_experience': {
      const { storefrontId: _, ...input } =
        experienceToolInputs.preview_experience.parse(raw);
      const performance = await readExperiencePerformance(
        ctx,
        input.buildId,
        deps.readPerformance,
        'storefront.write'
      );
      const preview = await deps.preview(ctx, input);
      return {
        ...preview,
        performance: {
          status: performance.status,
          qualification: performance.qualification,
        },
      };
    }
    case 'apply_experience': {
      const { storefrontId: _, ...v } =
        experienceToolInputs.apply_experience.parse(raw);
      return requestDraftApply(ctx, v);
    }
    case 'publish_experience': {
      const input = experienceToolInputs.publish_experience.parse(raw);
      const performance = await readExperiencePerformance(
        ctx,
        input.buildId,
        deps.readPerformance,
        'storefront.publish'
      );
      if (performance.qualification.status !== 'passed')
        throw new CandidatePerformanceQualificationError(
          performance.qualification.status === 'not-measured'
            ? 'missing-metrics'
            : performance.qualification.reason
        );
      return requestExperiencePublication(
        ctx,
        input,
        'publish',
        deps.readPerformance
      );
    }
    case 'rollback_experience':
      return requestExperienceRollback(ctx, raw, deps.readPerformance);
    case 'read_experience_evidence': {
      const v = experienceToolInputs.read_experience_evidence.parse(raw);
      const r = await ctx.supabase
        .from('experience_snapshots')
        .select('id,build_id,build_digest')
        .eq('id', v.evidenceId)
        .eq('merchant_id', ctx.merchantId)
        .maybeSingle();
      if (r.error || !r.data) throw Error('NOT_FOUND');
      return {
        evidenceId: r.data.id,
        buildId: r.data.build_id,
        buildDigest: r.data.build_digest,
      };
    }
  }
}
