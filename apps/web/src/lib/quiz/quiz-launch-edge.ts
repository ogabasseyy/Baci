import type {
  QuizDraftEvent,
  QuizSupabaseClient,
} from '@/app/api/merchant/quiz/generate/quiz-generate-helpers';
import { isQuizDraftEvent } from '@/app/api/merchant/quiz/generate/quiz-generate-helpers';
import { logger } from '@/lib/logger';
import {
  isQuizEdgeProvisioningConfigured,
  provisionQuizEdgeRooms,
  type QuizEdgeLaunchConfig,
  rollbackQuizEdgeDraftBackendMode,
} from '@/lib/quiz/quiz-edge-provision';

export type QuizEdgeLaunchOutcome =
  | { event: QuizDraftEvent; ok: true }
  | { code: string; message: string; ok: false };

export type QuizLaunchedWithBackend = QuizDraftEvent & {
  backend_mode?: string;
  expected_room_count?: number | null;
};

export async function findLaunchedMerchantQuizWithBackendV2(args: {
  eventId: string;
  merchantId: string;
  supabase: QuizSupabaseClient;
}): Promise<QuizLaunchedWithBackend | null> {
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
  return {
    ...(typeof row.backend_mode === 'string'
      ? { backend_mode: row.backend_mode }
      : {}),
    expected_room_count:
      typeof row.expected_room_count === 'number'
        ? row.expected_room_count
        : null,
    id: data.id,
    slug: data.slug,
    status: data.status,
    title: data.title,
  };
}

export function resolveAlreadyLaunchedEdgeResult(
  alreadyLaunched: QuizLaunchedWithBackend,
  expectedRoomCount: number
): QuizEdgeLaunchOutcome {
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

/**
 * Provisions Cloudflare Edge rooms BEFORE launch commits. Returns `null` when
 * the caller should proceed to launch, or a terminal `QuizEdgeLaunchOutcome`
 * (idempotent success or failure).
 */
export async function prepareEdgeRoomsBeforeLaunch(args: {
  eventId: string;
  expectedRoomCount: number;
  launchConfig: QuizEdgeLaunchConfig;
  merchantId: string;
  supabase: QuizSupabaseClient;
}): Promise<QuizEdgeLaunchOutcome | null> {
  if (!isQuizEdgeProvisioningConfigured()) {
    return {
      code: 'QUIZ_EDGE_NOT_CONFIGURED',
      message:
        'Cloudflare Edge Quiz Rooms are not configured on this server (missing QUIZ_EDGE_WORKER_URL or QUIZ_INTERNAL_COORDINATOR_SECRET).',
      ok: false,
    };
  }

  const provisioned = await provisionQuizEdgeRooms({
    eventId: args.eventId,
    expectedRoomCount: args.expectedRoomCount,
    launchConfig: args.launchConfig,
    merchantId: args.merchantId,
    supabase: args.supabase,
  });
  if (provisioned.ok) return null;

  if (provisioned.code === 'QUIZ_EVENT_NOT_DRAFT') {
    const alreadyLaunched = await findLaunchedMerchantQuizWithBackendV2({
      eventId: args.eventId,
      merchantId: args.merchantId,
      supabase: args.supabase,
    });
    if (alreadyLaunched) {
      return resolveAlreadyLaunchedEdgeResult(
        alreadyLaunched,
        args.expectedRoomCount
      );
    }
  }
  return {
    code: provisioned.code,
    message: provisioned.message,
    ok: false,
  };
}

export async function resolveLateEdgeLaunchFallback(args: {
  eventId: string;
  expectedRoomCount: number;
  merchantId: string;
  raceLabel: string;
  supabase: QuizSupabaseClient;
}): Promise<QuizEdgeLaunchOutcome | null> {
  const alreadyLaunched = await findLaunchedMerchantQuizWithBackendV2({
    eventId: args.eventId,
    merchantId: args.merchantId,
    supabase: args.supabase,
  });
  if (!alreadyLaunched) return null;
  const resolved = resolveAlreadyLaunchedEdgeResult(
    alreadyLaunched,
    args.expectedRoomCount
  );
  if (!resolved.ok) {
    logger.warn({
      backendMode: alreadyLaunched.backend_mode,
      event: 'quiz_edge_provision_orphaned_after_launch_race',
      eventId: args.eventId,
      expectedRoomCount: args.expectedRoomCount,
      merchantId: args.merchantId,
      message: `Edge rooms were provisioned before losing a concurrent ${args.raceLabel} launch race`,
    });
  }
  return resolved;
}

export async function rollbackEdgeDraftAndAnnotateFailure(args: {
  eventId: string;
  failure: { code: string; message: string; ok: false };
  merchantId: string;
  supabase: QuizSupabaseClient;
}): Promise<{ code: string; message: string; ok: false }> {
  const rolledBack = await rollbackQuizEdgeDraftBackendMode({
    eventId: args.eventId,
    merchantId: args.merchantId,
    supabase: args.supabase,
  });
  return rolledBack
    ? args.failure
    : {
        ...args.failure,
        message: `${args.failure.message} Automatic Edge draft reset also failed.`,
      };
}
