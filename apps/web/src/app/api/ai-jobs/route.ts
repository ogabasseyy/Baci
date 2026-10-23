import { cookies } from 'next/headers';
import { after, type NextRequest, NextResponse } from 'next/server';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { triggerAiStorefrontWorker } from '@/lib/ai-storefront/trigger-storefront-worker';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { enqueueNativeLayout } from '@/lib/website-builder/enqueue-native-layout';
import { createAiJobSchema } from '@/schemas/ai-jobs';

// POST /api/ai-jobs - Create a new AI job
export async function POST(request: NextRequest) {
  try {
    // CSRF protection
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant record (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const merchantId = merchantContext.merchantId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedBody = createAiJobSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const { type, input } = parsedBody.data;

    // Permission check
    const access = toUserAccess(merchantContext);
    const requiredPermission =
      type === 'storefront_layout_generation'
        ? { resource: 'builder', action: 'edit' }
        : { resource: 'products', action: 'create' };
    if (
      !hasPermission(
        access,
        requiredPermission.resource,
        requiredPermission.action
      )
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Private layout starters are captured under caller RLS in the enqueue transaction.
    const queued =
      BUILDER_PRIVATE_STORAGE_ENABLED && type === 'storefront_layout_generation'
        ? await enqueueNativeLayout(supabase, merchantId, input)
        : await supabase
            .from('ai_jobs')
            .insert({ merchant_id: merchantId, type, input, status: 'pending' })
            .select('id, merchant_id, type, status, input, created_at')
            .single();
    const jobError = queued.error;
    const job = queued.data;

    if (jobError || !job) {
      console.error('Error creating AI job:', {
        code: jobError?.code ?? 'MISSING_JOB_RECEIPT',
      });
      return NextResponse.json(
        { error: 'Failed to create job' },
        { status: 500 }
      );
    }

    if (type === 'storefront_layout_generation') {
      after(async () => {
        try {
          await triggerAiStorefrontWorker({
            jobId: job.id,
            merchantId,
            source: 'api',
          });
        } catch (error) {
          logger.error({
            message: 'AI storefront worker trigger failed',
            jobId: job.id,
            merchantId,
            error,
          });
        }
      });
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/ai-jobs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/ai-jobs - Get jobs for the merchant
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant record (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // Permission check
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const limit = Number.parseInt(searchParams.get('limit') || '10', 10);

    let query = supabase
      .from('ai_jobs')
      .select(
        'id, merchant_id, type, status, input, output, error, created_at, started_at, completed_at'
      )
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: jobs, error } = await query;

    if (error) {
      console.error('Error fetching AI jobs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Unexpected error in GET /api/ai-jobs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
