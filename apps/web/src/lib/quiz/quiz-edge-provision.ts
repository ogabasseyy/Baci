import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  getQuizEdgeWorkerUrl,
  getQuizInternalCoordinatorSecret,
} from '@/lib/quiz/quiz-edge-config';

const edgeProvisionPayloadSchema = z.object({
  roomIds: z.array(z.string().min(1)).min(1).max(256),
  config: z.object({
    eventId: z.string().min(1),
    merchantId: z.string().min(1),
    mode: z.enum(['test', 'live']),
    contractVersion: z.literal(2),
    rulesVersion: z.string().min(1),
    questionCount: z.number().int().positive(),
    timePerQuestionSeconds: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    startsAtMs: z.number().finite(),
    endsAtMs: z.number().finite(),
    status: z.enum([
      'draft',
      'scheduled',
      'active',
      'finalizing',
      'completed',
      'cancelled',
    ]),
    slots: z
      .array(
        z.object({
          id: z.string().min(1),
          slotIndex: z.number().int().positive(),
          active: z.boolean(),
          variants: z
            .array(
              z.object({
                id: z.string().min(1),
                slotId: z.string().min(1),
                prompt: z.string().min(1),
                options: z.array(
                  z.object({
                    id: z.string().min(1),
                    label: z.string().min(1),
                  })
                ),
                answerKeyHash: z.string().min(1),
                active: z.boolean(),
              })
            )
            .min(1),
        })
      )
      .min(1),
  }),
});

export interface QuizEdgeProvisionSupabase {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export interface QuizEdgeLaunchConfig {
  endsAt: string;
  maxAttempts: number;
  questionCount: number;
  rulesVersion: string;
  startsAt: string;
  status: 'scheduled' | 'active';
  timePerQuestionSeconds: number;
}

export type QuizEdgeProvisionResult =
  | { ok: true; roomCount: number }
  | { code: string; message: string; ok: false };

const PROVISION_TIMEOUT_MS = 10_000;

export function isQuizEdgeProvisioningConfigured(): boolean {
  return Boolean(getQuizEdgeWorkerUrl() && getQuizInternalCoordinatorSecret());
}

/**
 * Reverts a draft event's `backend_mode` back to `'postgres'` via the
 * `reset_quiz_edge_rooms_draft_v2` SECURITY DEFINER RPC when Edge room
 * initialization or the subsequent launch step fails.
 */
export async function rollbackQuizEdgeDraftBackendMode(args: {
  eventId: string;
  merchantId: string;
  supabase: QuizEdgeProvisionSupabase;
}): Promise<boolean> {
  try {
    const { error } = await args.supabase.rpc(
      'reset_quiz_edge_rooms_draft_v2',
      {
        p_event_id: args.eventId,
        p_merchant_id: args.merchantId,
      }
    );
    if (error) {
      logger.error({
        code: error.code,
        event: 'quiz_edge_provision_rollback_failed',
        eventId: args.eventId,
        merchantId: args.merchantId,
        message: 'reset_quiz_edge_rooms_draft_v2 RPC returned an error',
      });
      return false;
    }
    return true;
  } catch (cause) {
    logger.error({
      cause: cause instanceof Error ? cause.message : String(cause),
      event: 'quiz_edge_provision_rollback_failed',
      eventId: args.eventId,
      merchantId: args.merchantId,
      message: 'reset_quiz_edge_rooms_draft_v2 RPC threw unexpectedly',
    });
    return false;
  }
}

function mapPrepareRpcError(code?: string): QuizEdgeProvisionResult {
  // Defensive mapping for `guard_quiz_event_backend_mode_lock_v2` (QZ060);
  // draft-only gating normally returns QZ061 first for non-draft events.
  if (code === 'QZ060') {
    return {
      code: 'QUIZ_BACKEND_MODE_LOCKED',
      message: 'Cannot switch backend mode after players have checked in.',
      ok: false,
    };
  }
  if (code === 'QZ061') {
    return {
      code: 'QUIZ_EVENT_NOT_DRAFT',
      message: 'Quiz event is no longer a draft and cannot be re-provisioned.',
      ok: false,
    };
  }
  if (code === 'QZ003') {
    return {
      code: 'QUIZ_QUESTION_POOL_INCOMPLETE',
      message: 'Quiz question pool is incomplete for Edge Rooms provisioning.',
      ok: false,
    };
  }
  if (code === '22023') {
    return {
      code: 'QUIZ_EDGE_CONFIG_INVALID',
      message:
        'Invalid Edge Rooms configuration (room count must be between 1 and 256).',
      ok: false,
    };
  }
  return {
    code: 'QUIZ_EDGE_PROVISION_FAILED',
    message: 'Could not prepare quiz rooms in the database.',
    ok: false,
  };
}

/**
 * Sets `backend_mode = 'edge_rooms'` and `expected_room_count` on a draft quiz
 * event via `prepare_quiz_edge_rooms_v2`, then initializes all room Durable
 * Objects and the EventCoordinatorDO on the Cloudflare Quiz Edge Worker before
 * launch flips the event status.
 */
export async function provisionQuizEdgeRooms(args: {
  eventId: string;
  expectedRoomCount: number;
  fetchImpl?: typeof fetch;
  launchConfig?: QuizEdgeLaunchConfig;
  merchantId: string;
  supabase: QuizEdgeProvisionSupabase;
}): Promise<QuizEdgeProvisionResult> {
  const edgeBaseUrl = getQuizEdgeWorkerUrl();
  const coordinatorSecret = getQuizInternalCoordinatorSecret();
  if (!edgeBaseUrl || !coordinatorSecret) {
    return {
      code: 'QUIZ_EDGE_NOT_CONFIGURED',
      message:
        'Cloudflare Edge Quiz Rooms are not configured on this server (missing QUIZ_EDGE_WORKER_URL or QUIZ_INTERNAL_COORDINATOR_SECRET).',
      ok: false,
    };
  }

  const rpcArgs: Record<string, unknown> = {
    p_event_id: args.eventId,
    p_expected_room_count: args.expectedRoomCount,
    p_merchant_id: args.merchantId,
    ...(args.launchConfig
      ? {
          p_ends_at: args.launchConfig.endsAt,
          p_max_attempts: args.launchConfig.maxAttempts,
          p_question_count: args.launchConfig.questionCount,
          p_rules_version: args.launchConfig.rulesVersion,
          p_starts_at: args.launchConfig.startsAt,
          p_target_status: args.launchConfig.status,
          p_time_per_question_seconds: args.launchConfig.timePerQuestionSeconds,
        }
      : {}),
  };

  const { data, error } = await args.supabase.rpc(
    'prepare_quiz_edge_rooms_v2',
    rpcArgs
  );

  if (error) {
    logger.error({
      code: error.code,
      event: 'prepare_quiz_edge_rooms_v2_failed',
      eventId: args.eventId,
      merchantId: args.merchantId,
      message: 'prepare_quiz_edge_rooms_v2 RPC failed',
    });
    return mapPrepareRpcError(error.code);
  }

  const parsed = edgeProvisionPayloadSchema.safeParse(data);
  if (!parsed.success) {
    logger.error({
      event: 'prepare_quiz_edge_rooms_v2_invalid_payload',
      eventId: args.eventId,
      issues: parsed.error.issues,
      merchantId: args.merchantId,
      message: 'prepare_quiz_edge_rooms_v2 returned an invalid payload',
    });
    await rollbackQuizEdgeDraftBackendMode(args);
    return {
      code: 'QUIZ_EDGE_PROVISION_INVALID_PAYLOAD',
      message: 'Quiz question pool is incomplete for Edge Rooms provisioning.',
      ok: false,
    };
  }

  const fetchFn = args.fetchImpl ?? fetch;
  try {
    const response = await fetchFn(`${edgeBaseUrl}/api/quiz/admin/init-rooms`, {
      body: JSON.stringify(parsed.data),
      headers: {
        Authorization: `Bearer ${coordinatorSecret}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(PROVISION_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error({
        event: 'quiz_edge_init_rooms_http_error',
        eventId: args.eventId,
        merchantId: args.merchantId,
        message: 'Cloudflare Worker init-rooms returned non-2xx status',
        status: response.status,
      });
      await rollbackQuizEdgeDraftBackendMode(args);
      return {
        code: 'QUIZ_EDGE_INIT_ROOMS_FAILED',
        message: `Cloudflare Edge Worker rejected room provisioning (HTTP ${response.status}).`,
        ok: false,
      };
    }

    return { ok: true, roomCount: parsed.data.roomIds.length };
  } catch (cause) {
    logger.error({
      cause: cause instanceof Error ? cause.message : String(cause),
      event: 'quiz_edge_init_rooms_network_error',
      eventId: args.eventId,
      merchantId: args.merchantId,
      message: 'Cloudflare Worker init-rooms request failed',
    });
    await rollbackQuizEdgeDraftBackendMode(args);
    return {
      code: 'QUIZ_EDGE_INIT_ROOMS_FAILED',
      message:
        'Could not reach Cloudflare Edge Worker to initialize quiz rooms.',
      ok: false,
    };
  }
}
