import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import {
  OxygenDraftError,
  readOxygenDraft,
  readOxygenDraftForLocalAttempt,
  saveOxygenDraft,
} from '@/lib/payments/oxygen/draft-store';
import { oxygenDraftWriteSchema } from '@/schemas/oxygen-form-draft';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
function failure(error: unknown) {
  const code = error instanceof OxygenDraftError ? error.code : 'unavailable';
  const status =
    code === 'not_found'
      ? 404
      : ['conflict', 'stage_locked'].includes(code)
        ? 409
        : 503;
  return NextResponse.json(
    {
      error:
        code === 'conflict'
          ? 'This application changed elsewhere. Reload saved progress before continuing.'
          : 'Saved progress unavailable',
      code,
    },
    { status, headers }
  );
}
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get('workflowId'));
  if (!id.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  const source = request.nextUrl.searchParams.get('sourceWorkflowId');
  const sourceId = source ? z.uuid().safeParse(source) : null;
  if (sourceId && !sourceId.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    return NextResponse.json(
      sourceId?.success
        ? await readOxygenDraftForLocalAttempt(
            auth.supabase,
            auth.user.id,
            id.data,
            sourceId.data
          )
        : await readOxygenDraft(auth.supabase, auth.user.id, id.data),
      { headers }
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403, headers })
    );
  if (
    !(await ensureActionRateLimit('oxygen-draft-save', {
      requests: 90,
      windowMs: 60_000,
    }))
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  const size = Number(request.headers.get('content-length') ?? 0);
  if (size > 8192)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 413, headers }
    );
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 8192)
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 413, headers }
      );
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  }
  const input = oxygenDraftWriteSchema.safeParse(raw);
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    return NextResponse.json(
      await saveOxygenDraft(auth.supabase, auth.user.id, input.data),
      { headers }
    );
  } catch (error) {
    return failure(error);
  }
}
