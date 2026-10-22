import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { checkRateLimit } from '@/lib/rate-limiter';
import { createClient } from '@/lib/supabase/server';
import { applyAiDraftSchema } from '@/schemas/ai-jobs';
import { builderConfigSchema } from '@/schemas/builder';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AiDraftOutput {
  generatedConfig?: unknown;
  generatedAgainstUpdatedAt?: unknown;
}

const aiDraftIdParamsSchema = z.strictObject({ id: z.uuid() });

type RequestBodyResult =
  | { body: unknown; response?: never }
  | { response: NextResponse; body?: never };

function getAiDraftOutput(output: unknown): AiDraftOutput | null {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return null;
  }

  const candidate = output as Record<string, unknown>;
  return {
    generatedConfig: candidate.generatedConfig,
    generatedAgainstUpdatedAt: candidate.generatedAgainstUpdatedAt,
  };
}

async function readOptionalJsonBody(
  request: NextRequest
): Promise<RequestBodyResult> {
  const rawBody = await request.text();
  if (!rawBody.trim()) return { body: {} };

  try {
    return { body: JSON.parse(rawBody) as unknown };
  } catch {
    return {
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      ),
    };
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) return response as NextResponse;

  const parsedParams = aiDraftIdParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Invalid AI draft id', code: 'invalid_ai_draft_id' },
      { status: 400 }
    );
  }

  const bodyResult = await readOptionalJsonBody(request);
  if (bodyResult.response) return bodyResult.response;

  const parsedRequest = applyAiDraftSchema.safeParse(bodyResult.body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: 'Invalid request body', code: 'invalid_request_body' },
      { status: 400 }
    );
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: parsedRequest.data.merchantId,
  });
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'builder', 'edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isAllowed = await checkRateLimit(
    supabase,
    user.id,
    'ai_storefront_apply',
    10,
    1
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited' },
      { status: 429 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from('ai_jobs')
    .select('id, merchant_id, type, status, output')
    .eq('id', parsedParams.data.id)
    .eq('merchant_id', merchantContext.merchantId)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: 'Failed to load job' }, { status: 500 });
  }
  if (job?.type !== 'storefront_layout_generation') {
    return NextResponse.json({ error: 'AI draft not found' }, { status: 404 });
  }
  if (job.status !== 'completed') {
    return NextResponse.json(
      { error: 'AI draft is not ready', code: 'ai_job_not_completed' },
      { status: 409 }
    );
  }

  const draftOutput = getAiDraftOutput(job.output);
  const parsedConfig = builderConfigSchema.safeParse(
    draftOutput?.generatedConfig
  );
  const generatedAgainstUpdatedAt =
    typeof draftOutput?.generatedAgainstUpdatedAt === 'string'
      ? draftOutput.generatedAgainstUpdatedAt
      : null;

  if (!parsedConfig.success || !generatedAgainstUpdatedAt) {
    return NextResponse.json(
      { error: 'AI draft output is invalid' },
      { status: 400 }
    );
  }

  const { data: pageConfig, error: pageConfigError } = await supabase
    .from('page_configs')
    .select('id, updated_at')
    .eq('merchant_id', merchantContext.merchantId)
    .eq('page_slug', 'home')
    .maybeSingle();

  if (pageConfigError) {
    return NextResponse.json(
      { error: 'Failed to load page config' },
      { status: 500 }
    );
  }
  if (!pageConfig) {
    return NextResponse.json(
      { error: 'Home page config not found' },
      { status: 404 }
    );
  }

  if (
    !parsedRequest.data.force &&
    pageConfig.updated_at !== generatedAgainstUpdatedAt
  ) {
    return NextResponse.json(
      {
        error: 'AI draft is stale',
        code: 'ai_draft_stale',
        message:
          'This AI draft was generated from an older version of your store. Review before replacing your current draft.',
      },
      { status: 409 }
    );
  }

  const { data: applyResult, error: applyError } = await supabase
    .rpc('apply_ai_storefront_draft', {
      p_job_id: job.id,
      p_merchant_id: merchantContext.merchantId,
      p_page_slug: 'home',
      p_generated_config: parsedConfig.data,
      p_generated_against_updated_at: generatedAgainstUpdatedAt,
      p_force: parsedRequest.data.force,
    })
    .maybeSingle<{
      applied: boolean;
      code: string | null;
      page_config_id: string | null;
      updated_at: string | null;
    }>();

  if (applyError?.code === '40001')
    return NextResponse.json(
      { error: 'AI draft is stale', code: 'ai_draft_stale' },
      { status: 409 }
    );
  if (applyError) {
    console.error('Failed to atomically apply AI draft', {
      code: applyError.code,
    });
    return NextResponse.json(
      { error: 'Failed to apply AI draft' },
      { status: 500 }
    );
  }

  if (!applyResult) {
    return NextResponse.json(
      { error: 'Failed to apply AI draft' },
      { status: 500 }
    );
  }

  if (!applyResult.applied && applyResult.code === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!applyResult.applied && applyResult.code === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!applyResult.applied && applyResult.code === 'job_not_found') {
    return NextResponse.json({ error: 'AI draft not found' }, { status: 404 });
  }

  if (!applyResult.applied && applyResult.code === 'job_already_applied') {
    return NextResponse.json(
      { error: 'AI draft already applied', code: 'job_already_applied' },
      { status: 410 }
    );
  }

  if (!applyResult.applied && applyResult.code === 'page_config_not_found') {
    return NextResponse.json(
      { error: 'Home page config not found' },
      { status: 404 }
    );
  }

  if (!applyResult.applied && applyResult.code === 'ai_draft_stale') {
    return NextResponse.json(
      { error: 'AI draft is stale', code: 'ai_draft_stale' },
      { status: 409 }
    );
  }

  if (!applyResult.applied) {
    return NextResponse.json(
      { error: 'Failed to apply AI draft' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    lastUpdated: applyResult.updated_at,
  });
}
