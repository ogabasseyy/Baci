import { QuizBatchReassembler } from './batch-packer';
import type { QuizAttemptBundle, QuizPackedQueueMessage } from './contracts';
import { QuizRoomError } from './contracts';
import { sha256Hex } from './crypto';
import { requireConfiguredSecret } from './ticket';

export interface QuizQueueMessageLike<T = unknown> {
  readonly id: string;
  readonly body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QuizQueueBatchLike<T = unknown> {
  readonly queue: string;
  readonly messages: readonly QuizQueueMessageLike<T>[];
}

export interface QuizQueueConsumerEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  QUIZ_BATCH_WORKER_JWT?: string;
}

export interface QuizQueueIngestResult {
  acked: number;
  retried: number;
  duplicates: number;
  attemptsIngested: number;
}

interface PostgresAttemptRowPayload {
  attempt_id: string;
  admission_id: string;
  customer_id: string;
  attempt_number: number;
  integrity_tier: string;
  leaderboard_username: string;
  rules_version: string;
  terms_accepted_at: string;
  app_version: string;
  platform: string;
  start_request_id: string;
  started_at: string;
  submitted_at: string;
  close_reason: string;
  bundle_checksum_sha256: string;
  answers: readonly {
    slot_id: string;
    variant_id: string;
    position: number;
    option_order: readonly string[];
    issued_at: string;
    received_at: string;
    raw_answer: string | null;
    selected_answer_hash: string | null;
    answered_in_ms: number;
    timeout: boolean;
  }[];
}

function toPostgresAttemptPayload(
  bundle: QuizAttemptBundle
): PostgresAttemptRowPayload {
  return {
    attempt_id: bundle.attemptId,
    admission_id: bundle.admissionId,
    customer_id: bundle.customerId,
    attempt_number: bundle.attemptNumber,
    integrity_tier: bundle.integrityTier,
    leaderboard_username: bundle.leaderboardUsername,
    rules_version: bundle.rulesVersion,
    terms_accepted_at: new Date(bundle.startedAtMs).toISOString(),
    app_version: bundle.appVersion,
    platform: bundle.platform,
    start_request_id: bundle.startRequestId,
    started_at: new Date(bundle.startedAtMs).toISOString(),
    submitted_at: new Date(bundle.submittedAtMs).toISOString(),
    close_reason: bundle.closeReason,
    bundle_checksum_sha256: bundle.bundleChecksumSha256,
    answers: bundle.answers.map((ans) => ({
      slot_id: ans.slotId,
      variant_id: ans.variantId,
      position: ans.position,
      option_order: ans.optionOrder,
      issued_at: new Date(ans.issuedAtMs).toISOString(),
      received_at: new Date(ans.receivedAtMs).toISOString(),
      raw_answer: ans.rawAnswer,
      selected_answer_hash: ans.selectedAnswerHash,
      answered_in_ms: ans.answeredInMs,
      timeout: ans.timeout,
    })),
  };
}

function isPackedQueueMessage(value: unknown): value is QuizPackedQueueMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.batchId === 'string' &&
    typeof obj.eventId === 'string' &&
    typeof obj.roomId === 'string' &&
    typeof obj.payloadSha256 === 'string' &&
    Array.isArray(obj.bundles)
  );
}

async function postIngestRpc(
  fetchImpl: typeof fetch,
  supabaseUrl: string,
  workerJwt: string,
  anonKey: string,
  body: Record<string, unknown>
): Promise<{
  status: number;
  ingested: boolean;
  duplicate: boolean;
  attemptsInserted: number;
}> {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/ingest_quiz_edge_attempt_batch_v2`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerJwt}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return {
      status: response.status,
      ingested: false,
      duplicate: false,
      attemptsInserted: 0,
    };
  }
  const parsed = (await response.json()) as {
    ingested?: boolean;
    duplicate?: boolean;
    attemptsInserted?: number;
  };
  return {
    status: response.status,
    ingested: Boolean(parsed.ingested),
    duplicate: Boolean(parsed.duplicate),
    attemptsInserted: Number(parsed.attemptsInserted ?? 0),
  };
}

function isTransientStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export async function handleQuizQueueBatch(
  batch: QuizQueueBatchLike,
  env: QuizQueueConsumerEnv,
  fetchImpl: typeof fetch = fetch
): Promise<QuizQueueIngestResult> {
  let supabaseUrl: string;
  let workerJwt: string;
  try {
    supabaseUrl = requireConfiguredSecret(env.SUPABASE_URL, 'SUPABASE_URL');
    workerJwt = requireConfiguredSecret(
      env.QUIZ_BATCH_WORKER_JWT,
      'QUIZ_BATCH_WORKER_JWT'
    );
  } catch (error) {
    if (
      error instanceof QuizRoomError &&
      error.code === 'QUIZ_CONFIG_MISSING'
    ) {
      for (const msg of batch.messages) {
        msg.retry({ delaySeconds: 30 });
      }
      return {
        acked: 0,
        retried: batch.messages.length,
        duplicates: 0,
        attemptsIngested: 0,
      };
    }
    throw error;
  }

  const anonKey =
    env.SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY.trim().length > 0
      ? env.SUPABASE_ANON_KEY
      : workerJwt;

  const reassembler = new QuizBatchReassembler();
  const result: QuizQueueIngestResult = {
    acked: 0,
    retried: 0,
    duplicates: 0,
    attemptsIngested: 0,
  };

  for (const msg of batch.messages) {
    if (!isPackedQueueMessage(msg.body)) {
      msg.ack();
      result.acked += 1;
      continue;
    }

    const packed = msg.body;
    let reassembled: Awaited<ReturnType<QuizBatchReassembler['acceptMessage']>>;
    try {
      reassembled = await reassembler.acceptMessage(packed);
    } catch {
      // Corrupt payload / checksum mismatch cannot succeed on retry; ack to avoid poison-pill loop.
      msg.ack();
      result.acked += 1;
      continue;
    }

    if (reassembled.duplicateBatch) {
      msg.ack();
      result.acked += 1;
      result.duplicates += 1;
      continue;
    }

    // Keep split metadata consistent across parts regardless of whether parts arrive
    // in the same queue() batch or across separate invocations.
    const firstSplit =
      packed.bundles.length === 1 && (packed.bundles[0]?.totalParts ?? 1) > 1
        ? packed.bundles[0]
        : undefined;
    const isSplitPart = firstSplit !== undefined;

    const bundlesToSend = isSplitPart
      ? packed.bundles
      : reassembled.completedBundles.length > 0
        ? reassembled.completedBundles
        : packed.bundles;

    if (bundlesToSend.some((b) => !Array.isArray(b.answers))) {
      msg.ack();
      result.acked += 1;
      continue;
    }

    const partIndex = 0;
    const totalParts = 1;
    const answerCount = bundlesToSend.reduce(
      (sum, b) => sum + b.answers.length,
      0
    );
    const batchChecksum = await sha256Hex(JSON.stringify(bundlesToSend));

    try {
      const rpc = await postIngestRpc(
        fetchImpl,
        supabaseUrl,
        workerJwt,
        anonKey,
        {
          p_event_id: packed.eventId,
          p_room_id: packed.roomId,
          p_batch_id: packed.batchId,
          p_batch_checksum_sha256: batchChecksum,
          p_attempt_count: bundlesToSend.length,
          p_answer_count: answerCount,
          p_attempts: bundlesToSend.map(toPostgresAttemptPayload),
          p_part_index: partIndex,
          p_total_parts: totalParts,
        }
      );

      if (rpc.status >= 200 && rpc.status < 300) {
        msg.ack();
        result.acked += 1;
        if (rpc.duplicate) result.duplicates += 1;
        result.attemptsIngested += rpc.attemptsInserted;
      } else if (isTransientStatus(rpc.status)) {
        msg.retry({ delaySeconds: 5 });
        result.retried += 1;
      } else {
        msg.ack();
        result.acked += 1;
      }
    } catch {
      msg.retry({ delaySeconds: 5 });
      result.retried += 1;
    }
  }

  return result;
}
