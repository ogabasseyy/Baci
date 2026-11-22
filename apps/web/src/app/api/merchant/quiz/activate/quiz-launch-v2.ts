import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import {
  isQuizEdgeProvisioningConfigured,
  provisionQuizEdgeRooms,
  rollbackQuizEdgeDraftBackendMode,
} from '@/lib/quiz/quiz-edge-provision';
import { getQuizRulesVersion } from '@/lib/quiz/quiz-rules-version';
import { scheduleReservationProductPurge } from '@/lib/schedule-reservation-product-purge';
import type { MerchantQuizActivationV2Input } from '@/schemas/quiz';
import type {
  QuizDraftEvent,
  QuizSupabaseClient,
} from '../generate/quiz-generate-helpers';
import { isQuizDraftEvent } from '../generate/quiz-generate-helpers';

export type QuizLaunchV2Result =
  | { event: QuizDraftEvent; ok: true }
  | { code: string; message: string; ok: false };

export async function findLaunchedMerchantQuizV2(args: {
  eventId: string;
  merchantId: string;
  supabase: QuizSupabaseClient;
}): Promise<QuizDraftEvent | null> {
  const { data, error } = await args.supabase
    .from('quiz_events')
    .select('id, slug, status, title')
    .eq('id', args.eventId)
    .eq('merchant_id', args.merchantId)
    .eq('contract_version', 2)
    .in('status', ['active', 'scheduled'])
    .maybeSingle();

  return error || !isQuizDraftEvent(data) ? null : data;
}

async function findLaunchedMerchantQuizWithBackendV2(args: {
  eventId: string;
  merchantId: string;
  supabase: QuizSupabaseClient;
}): Promise<
  | (QuizDraftEvent & {
      backend_mode?: string;
      expected_room_count?: number | null;
    })
  | null
> {
  const { data, error } = await args.supabase
    .from('quiz_events')
    .select('id, slug, status, title, backend_mode, expected_room_count')
    .eq('id', args.eventId)
    .eq('merchant_id', args.merchantId)
    .eq('contract_version', 2)
    .in('status', ['active', 'scheduled'])
    .maybeSingle();

  if (error || !isQuizDraftEvent(data)) return null;
  const row = data as {
    backend_mode?: unknown;
    expected_room_count?: unknown;
  };
  const backendMode =
    typeof row.backend_mode === 'string' ? row.backend_mode : undefined;
  const expectedRoomCount =
    typeof row.expected_room_count === 'number'
      ? row.expected_room_count
      : null;
  return {
    ...(backendMode ? { backend_mode: backendMode } : {}),
    expected_room_count: expectedRoomCount,
    id: data.id,
    slug: data.slug,
    status: data.status,
    title: data.title,
  };
}

function resolveAlreadyLaunchedEdgeResult(
  alreadyLaunched: QuizDraftEvent & {
    backend_mode?: string;
    expected_room_count?: number | null;
  },
  expectedRoomCount: number
): QuizLaunchV2Result {
  if (alreadyLaunched.backend_mode !== 'edge_rooms') {
    return {
      code: 'QUIZ_BACKEND_MODE_LOCKED',
      message:
        'This quiz is already launched on Standard Postgres and cannot be switched to Edge Rooms.',
      ok: false,
    };
  }
  if (alreadyLaunched.expected_room_count !== expectedRoomCount) {
    return {
      code: 'QUIZ_EDGE_ROOM_COUNT_LOCKED',
      message: `This quiz is already launched with ${alreadyLaunched.expected_room_count ?? 'configured'} Edge rooms and cannot be changed to ${expectedRoomCount}.`,
      ok: false,
    };
  }
  return {
    event: {
      id: alreadyLaunched.id,
      slug: alreadyLaunched.slug,
      status: alreadyLaunched.status,
      title: alreadyLaunched.title,
    },
    ok: true,
  };
}

function resolveTiming(input: MerchantQuizActivationV2Input, now: Date) {
  if (input.timing.kind === 'scheduled') {
    return {
      endsAt: input.timing.endsAt,
      startsAt: input.timing.startsAt,
      status:
        Date.parse(input.timing.startsAt) > now.getTime()
          ? ('scheduled' as const)
          : ('active' as const),
    };
  }
  const startsAt = now.toISOString();
  return {
    endsAt: new Date(
      now.getTime() + input.timing.liveWindowSeconds * 1000
    ).toISOString(),
    startsAt,
    status: 'active' as const,
  };
}

function getLiveLaunchFailure(code?: string): QuizLaunchV2Result {
  if (code === 'QZ047')
    return {
      code: 'QUIZ_LIVE_REGULATORY_EVIDENCE_REQUIRED',
      message:
        'Add valid jurisdiction and regulatory evidence before launching.',
      ok: false,
    };
  if (['QZ042', 'QZ043', 'QZ044'].includes(code ?? ''))
    return {
      code: 'QUIZ_PRIZE_INVENTORY_UNAVAILABLE',
      message:
        'The selected prize is unavailable or has no reservable inventory.',
      ok: false,
    };
  if (code === 'QZ003')
    return {
      code: 'QUIZ_QUESTION_POOL_INCOMPLETE',
      message: 'The reviewed question pool is incomplete.',
      ok: false,
    };
  return {
    code: 'QUIZ_LAUNCH_FAILED',
    message: 'The reviewed quiz could not be launched.',
    ok: false,
  };
}

export async function launchMerchantQuizDraftV2(args: {
  input: MerchantQuizActivationV2Input;
  merchantId: string;
  now?: Date;
  supabase: QuizSupabaseClient;
}): Promise<QuizLaunchV2Result> {
  const { input, merchantId, supabase } = args;
  const rules = getQuizRulesVersion(input.rulesVersion);
  if (
    !rules ||
    (input.mode === 'test' && !rules.availableInTest) ||
    (input.mode === 'live' && !rules.approvedForLive)
  ) {
    return {
      code: 'QUIZ_RULES_NOT_AVAILABLE',
      message: 'Select an available quiz rules version before launching.',
      ok: false,
    };
  }
  const now = args.now ?? new Date();
  if (
    input.timing.kind === 'scheduled' &&
    Date.parse(input.timing.startsAt) <= now.getTime()
  ) {
    return {
      code: 'QUIZ_SCHEDULE_START_INVALID',
      message: 'Choose a scheduled start time in the future.',
      ok: false,
    };
  }
  if (input.mode === 'live' && !input.regulatoryCompliance) {
    return getLiveLaunchFailure('QZ047');
  }

  const timing = resolveTiming(input, now);
  const questionCount = input.answerKeyReview.questions.length;
  const wantsEdgeRooms = input.backendMode === 'edge_rooms';
  const expectedRoomCount =
    input.edgeRoomCount ?? (input.mode === 'live' ? 16 : 4);

  if (wantsEdgeRooms) {
    if (!isQuizEdgeProvisioningConfigured()) {
      return {
        code: 'QUIZ_EDGE_NOT_CONFIGURED',
        message:
          'Cloudflare Edge Quiz Rooms are not configured on this server (missing QUIZ_EDGE_WORKER_URL or QUIZ_INTERNAL_COORDINATOR_SECRET).',
        ok: false,
      };
    }

    // Provision Cloudflare Edge rooms BEFORE flipping launch status so a
    // Worker/RPC failure never leaves a live or scheduled event half-provisioned.
    // `prepare_quiz_edge_rooms_v2` only permits drafts, so retries on an
    // already-launched event return `QUIZ_EVENT_NOT_DRAFT` without touching DOs.
    const provisioned = await provisionQuizEdgeRooms({
      eventId: input.eventId,
      expectedRoomCount,
      launchConfig: {
        endsAt: timing.endsAt,
        maxAttempts: input.maxAttempts,
        questionCount,
        rulesVersion: input.rulesVersion,
        startsAt: timing.startsAt,
        status: timing.status,
        timePerQuestionSeconds: input.timePerQuestionSeconds,
      },
      merchantId,
      supabase,
    });

    if (!provisioned.ok) {
      if (provisioned.code === 'QUIZ_EVENT_NOT_DRAFT') {
        const alreadyLaunched = await findLaunchedMerchantQuizWithBackendV2({
          eventId: input.eventId,
          merchantId,
          supabase,
        });
        if (alreadyLaunched) {
          return resolveAlreadyLaunchedEdgeResult(
            alreadyLaunched,
            expectedRoomCount
          );
        }
      }
      return {
        code: provisioned.code,
        message: provisioned.message,
        ok: false,
      };
    }
  }

  if (input.mode === 'live') {
    const regulatory = input.regulatoryCompliance;
    if (!regulatory) return getLiveLaunchFailure('QZ047');

    const { data, error } = await supabase.rpc('launch_quiz_event_v2', {
      p_ends_at: timing.endsAt,
      p_event_id: input.eventId,
      p_question_count: questionCount,
      p_regulatory_basis: regulatory.basis,
      p_regulatory_evidence_ref: regulatory.evidenceReference,
      p_regulatory_jurisdiction: regulatory.jurisdiction,
      p_rules_version: input.rulesVersion,
      p_starts_at: timing.startsAt,
      p_time_per_question_seconds: input.timePerQuestionSeconds,
      p_time_zone: input.timeZone,
    });
    if (isQuizDraftEvent(data)) {
      expireProductBlogCache(merchantId);
      scheduleReservationProductPurge({
        merchantId,
        sourceId: input.eventId,
        source: 'quiz',
        supabase,
      });
      return { event: data, ok: true };
    }

    if (error?.code === 'QZ046') {
      if (wantsEdgeRooms) {
        const alreadyLaunched = await findLaunchedMerchantQuizWithBackendV2({
          eventId: input.eventId,
          merchantId,
          supabase,
        });
        if (alreadyLaunched) {
          const resolved = resolveAlreadyLaunchedEdgeResult(
            alreadyLaunched,
            expectedRoomCount
          );
          if (resolved.ok) {
            expireProductBlogCache(merchantId);
            scheduleReservationProductPurge({
              merchantId,
              sourceId: input.eventId,
              source: 'quiz',
              supabase,
            });
          }
          return resolved;
        }
      } else {
        const alreadyLaunched = await findLaunchedMerchantQuizV2({
          eventId: input.eventId,
          merchantId,
          supabase,
        });
        if (alreadyLaunched) {
          expireProductBlogCache(merchantId);
          scheduleReservationProductPurge({
            merchantId,
            sourceId: input.eventId,
            source: 'quiz',
            supabase,
          });
          return { event: alreadyLaunched, ok: true };
        }
      }
    }
    if (wantsEdgeRooms) {
      await rollbackQuizEdgeDraftBackendMode({
        eventId: input.eventId,
        merchantId,
        supabase,
      });
    }
    return getLiveLaunchFailure(error?.code);
  }

  const { data, error } = await supabase
    .from('quiz_events')
    .update({
      contract_version: 2,
      ends_at: timing.endsAt,
      live_window_seconds: Math.floor(
        (Date.parse(timing.endsAt) - Date.parse(timing.startsAt)) / 1000
      ),
      max_attempts: input.maxAttempts,
      maximum_play_seconds: questionCount * input.timePerQuestionSeconds,
      mode: input.mode,
      question_count: questionCount,
      rules_version: input.rulesVersion,
      starts_at: timing.startsAt,
      status: timing.status,
      time_per_question_seconds: input.timePerQuestionSeconds,
      time_zone: input.timeZone,
    })
    .eq('id', input.eventId)
    .eq('merchant_id', merchantId)
    .eq('status', 'draft')
    .select('id, slug, status, title')
    .maybeSingle();
  if (error) {
    if (wantsEdgeRooms) {
      await rollbackQuizEdgeDraftBackendMode({
        eventId: input.eventId,
        merchantId,
        supabase,
      });
    }
    return {
      code: 'QUIZ_LAUNCH_FAILED',
      message: 'The reviewed quiz could not be launched.',
      ok: false,
    };
  }
  if (isQuizDraftEvent(data)) return { event: data, ok: true };

  if (wantsEdgeRooms) {
    const alreadyLaunched = await findLaunchedMerchantQuizWithBackendV2({
      eventId: input.eventId,
      merchantId,
      supabase,
    });
    if (alreadyLaunched) {
      return resolveAlreadyLaunchedEdgeResult(
        alreadyLaunched,
        expectedRoomCount
      );
    }
    await rollbackQuizEdgeDraftBackendMode({
      eventId: input.eventId,
      merchantId,
      supabase,
    });
    return {
      code: 'QUIZ_LAUNCH_FAILED',
      message: 'The reviewed quiz could not be launched.',
      ok: false,
    };
  }

  const alreadyLaunched = await findLaunchedMerchantQuizV2({
    eventId: input.eventId,
    merchantId,
    supabase,
  });
  return alreadyLaunched
    ? { event: alreadyLaunched, ok: true }
    : {
        code: 'QUIZ_LAUNCH_FAILED',
        message: 'The reviewed quiz could not be launched.',
        ok: false,
      };
}
