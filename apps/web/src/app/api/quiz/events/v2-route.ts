import {
  QUIZ_ATTEMPTS_USED_HEADER,
  QUIZ_FREE_ENTRY_MODE,
} from '@baci/shared/constants';
import { quizV2EventsResponseSchema } from '@baci/shared/schemas';
import { type NextRequest, NextResponse } from 'next/server';
import {
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import {
  invalidInputResponse,
  quizRpcClientErrorResponse,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-auth';
import { logger } from '@/lib/logger';
import { quizEventsQuerySchema } from '@/schemas/quiz';

function merchantIdFromRow(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function normalizeEventsProjection(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  return {
    ...(value as Record<string, unknown>),
    entryMode: QUIZ_FREE_ENTRY_MODE,
  };
}

function wantsAttemptsUsed(request: NextRequest): boolean {
  return request.headers.get(QUIZ_ATTEMPTS_USED_HEADER) === '1';
}

// Installed apps validate events with a strict schema, so the opt-in field is
// removed unless the client asked for it.
function omitAttemptsUsed<T extends { events: object[] }>(payload: T): T {
  return {
    ...payload,
    events: payload.events.map((event) => {
      const { attemptsUsed: _omitted, ...rest } = event as {
        attemptsUsed?: unknown;
      };
      return rest;
    }),
  };
}

export async function getQuizEventsV2(request: NextRequest) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const parsedQuery = quizEventsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsedQuery.success) {
    return invalidInputResponse(parsedQuery.error.flatten().fieldErrors);
  }

  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;

  const { limit, merchantId, merchantSlug, offset } = parsedQuery.data;
  let merchantQuery = auth.supabase.from('merchants').select('id');
  if (merchantId) merchantQuery = merchantQuery.eq('id', merchantId);
  if (merchantSlug) merchantQuery = merchantQuery.eq('slug', merchantSlug);
  const { data: merchant, error: merchantError } =
    await merchantQuery.maybeSingle();
  if (merchantError) return rpcErrorResponse();

  const resolvedMerchantId = merchantIdFromRow(merchant);
  if (!resolvedMerchantId) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  const { data, error } = await auth.supabase.rpc('list_quiz_events_v2', {
    p_limit: limit,
    p_merchant_id: resolvedMerchantId,
    p_offset: offset,
  });
  if (error) {
    return quizRpcClientErrorResponse(error) ?? rpcErrorResponse();
  }

  const parsed = quizV2EventsResponseSchema.safeParse(
    normalizeEventsProjection(data)
  );
  if (!parsed.success) {
    logger.error({
      event: 'list_quiz_events_v2_invalid_projection',
      issues: parsed.error.issues,
      message: 'list_quiz_events_v2 returned an invalid projection',
      merchantId: resolvedMerchantId,
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  return NextResponse.json(
    wantsAttemptsUsed(request) ? parsed.data : omitAttemptsUsed(parsed.data)
  );
}
