import {
  type BuilderAiEditPlan,
  type BuilderAiEditRequest,
  builderAiEditContract,
  validateBuilderAiEditComplexity,
} from '@baci/shared/contracts';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-permissions';
import { applyBuilderAiEditPlan } from '@/lib/builder-ai/apply-builder-ai-edit-plan';
import { checkBuilderAiRateLimit } from '@/lib/builder-ai/builder-ai-rate-limit';
import { getBuilderAiRawPlanMediaWarning } from '@/lib/builder-ai/get-builder-ai-raw-plan-media-warning';
import { hasDuplicateBuilderAiComponentIds } from '@/lib/builder-ai/has-duplicate-builder-ai-component-ids';
import { logBuilderAiEvent } from '@/lib/builder-ai/log-builder-ai-event';
import { materializeBuilderAiProviderChain } from '@/lib/builder-ai/materialize-builder-ai-provider-chain';
import { normalizeBuilderAiComponentIds } from '@/lib/builder-ai/normalize-builder-ai-component-ids';
import { prepareBuilderAiEditPromptResponse } from '@/lib/builder-ai/prepare-builder-ai-edit-prompt-response';
import { runBuilderAiProviderChain } from '@/lib/builder-ai/run-builder-ai-provider-chain';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { builderGeminiRequestSchema } from '@/schemas/builder-gemini-request';
import { createBuilderAiProviderErrorResponse } from './create-builder-ai-provider-error-response';
import { createBuilderAiRateLimitResponse } from './create-builder-ai-rate-limit-response';
import { getBuilderAiCsrfRequest } from './get-builder-ai-csrf-request';

type Authentication = Omit<
  NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
  'authMode'
> & { authMode?: 'bearer' | 'cookie' };
type MerchantContext = NonNullable<
  Awaited<ReturnType<typeof getMerchantForApiRequest>>
>;
type BodyResult = Awaited<ReturnType<typeof readBoundedJsonBody>>;
export interface BuilderAiEditHandlerDependencies {
  authenticate: (request: Request) => Promise<Authentication | null>;
  checkCsrf: (request: NextRequest) => ReturnType<typeof checkCsrfProtection>;
  getMerchant: (
    supabase: Authentication['supabase'],
    userId: string,
    options: { requestedMerchantId: string }
  ) => Promise<MerchantContext | null>;
  materializeProviders: () => ReturnType<
    typeof materializeBuilderAiProviderChain
  >;
  rateLimit: (identifier: string) => ReturnType<typeof checkBuilderAiRateLimit>;
  readBody: (request: Request, maxBytes: number) => Promise<BodyResult>;
  runProviderChain: typeof runBuilderAiProviderChain;
}
export interface BuilderAiEditHandlerOptions {
  dependencies?: BuilderAiEditHandlerDependencies;
  mode?: 'legacy' | 'v1';
}
function dependencies(): BuilderAiEditHandlerDependencies {
  return {
    authenticate: getAuthenticatedUser,
    checkCsrf: checkCsrfProtection,
    getMerchant: getMerchantForApiRequest,
    materializeProviders: materializeBuilderAiProviderChain,
    rateLimit: checkBuilderAiRateLimit,
    readBody: readBoundedJsonBody,
    runProviderChain: runBuilderAiProviderChain,
  };
}
function isSemanticallyExecutable(
  plan: BuilderAiEditPlan,
  request: BuilderAiEditRequest
): boolean {
  if (plan.status === 'refused') return true;
  try {
    applyBuilderAiEditPlan(request.currentConfig, plan);
    return true;
  } catch {
    return false;
  }
}
function parseRequest(
  body: unknown,
  mode: 'legacy' | 'v1'
): BuilderAiEditRequest | null {
  if (mode === 'v1') {
    const parsed = builderAiEditContract.requestSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  }
  const legacy = builderGeminiRequestSchema.safeParse(body);
  return legacy.success
    ? {
        ...legacy.data,
        clientRequestId: crypto.randomUUID(),
        contractVersion: builderAiEditContract.version,
      }
    : null;
}

export async function handleBuilderAiEditRequest(
  request: Request,
  options: BuilderAiEditHandlerOptions = {}
): Promise<Response> {
  const seams = options.dependencies ?? dependencies();
  const mode = options.mode ?? 'v1';
  let auth: Authentication | null;
  try {
    auth = await seams.authenticate(request);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
  if (!auth)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csrf = await seams.checkCsrf(
    getBuilderAiCsrfRequest(request, auth.authMode)
  );
  if (!csrf.valid) return csrf.response as Response;
  const body = await seams.readBody(request, 1_048_576);
  if (!body.ok) {
    return NextResponse.json(
      body.reason === 'too_large'
        ? {
            code: 'builder_ai_request_too_large',
            error: 'Request body is too large',
          }
        : { error: 'Invalid JSON body' },
      { status: body.reason === 'too_large' ? 413 : 400 }
    );
  }
  const parsed = parseRequest(body.body, mode);
  if (
    !parsed ||
    hasDuplicateBuilderAiComponentIds(parsed.currentConfig) ||
    !validateBuilderAiEditComplexity(parsed.currentConfig).success
  ) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
  parsed.currentConfig = normalizeBuilderAiComponentIds(parsed.currentConfig);
  if (
    hasDuplicateBuilderAiComponentIds(parsed.currentConfig) ||
    !validateBuilderAiEditComplexity(parsed.currentConfig).success
  ) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
  let merchant: MerchantContext | null;
  try {
    merchant = await seams.getMerchant(auth.supabase, auth.user.id, {
      requestedMerchantId: parsed.merchantId,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error', requestId: parsed.clientRequestId },
      { status: 500 }
    );
  }
  if (!merchant)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(toUserAccess(merchant), 'builder', 'edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rate = seams.rateLimit(`builder:${auth.user.id}`);
  if (!rate.allowed) {
    return createBuilderAiRateLimitResponse(mode, parsed.clientRequestId);
  }
  const promptResult = prepareBuilderAiEditPromptResponse({
    currentConfig: parsed.currentConfig,
    prompt: parsed.prompt,
    requestId: parsed.clientRequestId,
  });
  if ('response' in promptResult) return promptResult.response;
  const materialized = seams.materializeProviders();
  if (materialized.providers.length === 0) {
    return createBuilderAiProviderErrorResponse(
      { code: 'ai_provider_unavailable' },
      parsed.clientRequestId
    );
  }
  logBuilderAiEvent('builder_ai_edit_requested', {
    merchantId: merchant.merchantId,
    requestId: parsed.clientRequestId,
    userId: auth.user.id,
  });
  let plan: BuilderAiEditPlan;
  try {
    plan = await seams.runProviderChain({
      currentConfig: parsed.currentConfig,
      deadlineAt: Date.now() + 25_000,
      logger: {
        warn: (metadata) => {
          const errorClass =
            typeof metadata.errorClass === 'string'
              ? metadata.errorClass
              : 'UnknownProviderError';
          logBuilderAiEvent(
            errorClass === 'AbortError' || errorClass === 'TimeoutError'
              ? 'builder_ai_timeout'
              : 'builder_ai_provider_fallback',
            {
              errorClass,
              merchantId: merchant.merchantId,
              provider:
                typeof metadata.provider === 'string'
                  ? metadata.provider
                  : 'unknown',
              requestId: parsed.clientRequestId,
              userId: auth.user.id,
            }
          );
        },
      },
      prompt: promptResult.prompt,
      providerChain: materialized.providers,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(24_000)]),
      validateSemantics: (candidate) =>
        isSemanticallyExecutable(candidate, parsed),
    });
  } catch (error) {
    logBuilderAiEvent('builder_ai_candidate_rejected', {
      merchantId: merchant.merchantId,
      requestId: parsed.clientRequestId,
      userId: auth.user.id,
    });
    return createBuilderAiProviderErrorResponse(error, parsed.clientRequestId);
  }
  if (plan.status === 'refused') {
    logBuilderAiEvent('builder_ai_candidate_rejected', {
      merchantId: merchant.merchantId,
      requestId: parsed.clientRequestId,
      userId: auth.user.id,
    });
    return NextResponse.json(
      {
        code: 'builder_ai_request_not_supported',
        details: 'This request is not supported',
        error: 'This request is not supported',
        requestId: parsed.clientRequestId,
      },
      { status: 422 }
    );
  }
  const result = applyBuilderAiEditPlan(parsed.currentConfig, plan);
  const rawMediaWarning = getBuilderAiRawPlanMediaWarning(plan);
  const candidate = builderAiEditContract.candidateSchema.parse({
    candidateConfig: result.candidateConfig,
    clientRequestId: parsed.clientRequestId,
    contractVersion: builderAiEditContract.version,
    operations: rawMediaWarning ? [] : plan.operations,
    summary: plan.summary,
    warnings: result.warnings,
  });
  const hasConfigChanged =
    JSON.stringify(
      builderAiEditContract.builderDataSchema.parse(parsed.currentConfig)
    ) !== JSON.stringify(candidate.candidateConfig);
  logBuilderAiEvent('builder_ai_candidate_created', {
    merchantId: merchant.merchantId,
    operationCount: candidate.operations.length,
    requestId: parsed.clientRequestId,
    userId: auth.user.id,
    warningCount: candidate.warnings.length,
  });
  if (mode === 'legacy') {
    logBuilderAiEvent('legacy_contract_used', {
      merchantId: merchant.merchantId,
      requestId: parsed.clientRequestId,
      userId: auth.user.id,
    });
    if (!hasConfigChanged) {
      return NextResponse.json(
        {
          code: 'builder_ai_no_safe_changes',
          details: candidate.warnings.join(' '),
          error: 'No safe changes were made',
          requestId: parsed.clientRequestId,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { config: candidate.candidateConfig },
      { headers: { 'X-RateLimit-Remaining': String(rate.remaining) } }
    );
  }
  return NextResponse.json(candidate, {
    headers: { 'X-RateLimit-Remaining': String(rate.remaining) },
  });
}
