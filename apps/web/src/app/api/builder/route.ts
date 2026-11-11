import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { readExperienceAuthoringMode } from '@/lib/experience/authoring-mode';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import {
  builderCreateSchema,
  builderLoadQuerySchema,
  builderPublishSchema,
} from '@/schemas/builder';
import {
  publishBuilderDraft,
  saveBuilderDraft,
} from './builder-draft-mutations';
import { loadBuilderPayload } from './builder-load-payload';
import {
  getBuilderAuthentication,
  getBuilderRequestContext,
} from './builder-request-context';

export async function GET(request: NextRequest) {
  const authentication = await getBuilderAuthentication(request);
  if (authentication.response) return authentication.response;

  const { searchParams } = new URL(request.url);
  const parsedQuery = builderLoadQuerySchema.safeParse({
    merchantId: searchParams.get('merchantId') ?? undefined,
    slug: searchParams.get('slug') ?? undefined,
    aiDraftJobId: searchParams.get('aiDraftJobId') ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: 'Invalid request query',
        details: parsedQuery.error.flatten(),
      },
      { status: 400 }
    );
  }

  const contextResult = await getBuilderRequestContext(
    request,
    'view',
    parsedQuery.data.merchantId,
    authentication.auth
  );
  if (contextResult.response) {
    return contextResult.response;
  }

  if (getExperienceOwnerRuntime()?.approval) {
    const mode = await readExperienceAuthoringMode(
      contextResult.context.supabase,
      contextResult.context.merchantId
    );
    if (mode !== 'legacy')
      return NextResponse.json(
        {
          authoringMode: mode,
          canEdit: false,
          editorUrl: `/builder/experience?merchant=${encodeURIComponent(contextResult.context.merchantId)}`,
        },
        { status: mode === 'full-code' ? 200 : 503 }
      );
  }

  const builderPayload = await loadBuilderPayload(
    contextResult.context.supabase,
    contextResult.context.merchantId,
    parsedQuery.data.slug,
    contextResult.context.canEdit,
    parsedQuery.data.aiDraftJobId
  );
  if (builderPayload.response) {
    return builderPayload.response;
  }

  return NextResponse.json(builderPayload.data);
}

export async function POST(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) return response as NextResponse;

  const authentication = await getBuilderAuthentication(request);
  if (authentication.response) return authentication.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = builderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const contextResult = await getBuilderRequestContext(
    request,
    'edit',
    parsed.data.merchantId,
    authentication.auth
  );
  if (contextResult.response) {
    return contextResult.response;
  }

  const saveResult = await saveBuilderDraft(
    contextResult.context.supabase,
    contextResult.context.merchantId,
    parsed.data
  );
  if (saveResult.response) {
    return saveResult.response;
  }

  return NextResponse.json({
    success: true,
    data: saveResult.data,
    lastUpdated: saveResult.lastUpdated,
  });
}

export async function PUT(request: NextRequest) {
  // Publish endpoint
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) return response as NextResponse;

  const authentication = await getBuilderAuthentication(request);
  if (authentication.response) return authentication.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = builderPublishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const contextResult = await getBuilderRequestContext(
    request,
    'edit',
    parsed.data.merchantId,
    authentication.auth
  );
  if (contextResult.response) {
    return contextResult.response;
  }

  const publishResult = await publishBuilderDraft(
    contextResult.context.supabase,
    contextResult.context.merchantId,
    parsed.data
  );
  if (publishResult.response) {
    return publishResult.response;
  }

  return NextResponse.json({
    success: true,
    lastUpdated: publishResult.lastUpdated,
  });
}
