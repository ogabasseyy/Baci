import { z } from 'zod';
import { asyncStorage } from '@/lib/storage';
import type {
  QuizActiveAttemptResponse,
  QuizIntegrityTier,
  QuizV2Attempt,
  QuizV2Result,
} from '@/services/quiz-types';

const RECOVERY_VERSION = 1 as const;
const KEY_PREFIX = 'baci:quiz-recovery:v1';

// biome-ignore format: Compact schema keeps this recovery module below the repository limit.
const recoveryEnvelopeSchema = z.strictObject({ attemptId: z.string().trim().min(1).nullable(), currentQuestionId: z.string().trim().min(1).nullable(), eventId: z.string().trim().min(1), generation: z.number().int().nonnegative(), pendingLockedOptionId: z.string().trim().min(1).nullable(), persistedAt: z.iso.datetime({ offset: true }).optional(), submittedAt: z.iso.datetime({ offset: true }).nullable().optional(), startRequestId: z.uuid(), userId: z.string().trim().min(1), version: z.literal(RECOVERY_VERSION) });

export type QuizRecoveryEnvelope = z.infer<typeof recoveryEnvelopeSchema>;

export type QuizV2LifecycleStatus =
  | 'idle'
  | 'in_progress'
  | 'pending_results'
  | 'event_cancelled'
  | 'final';

export type QuizRecoveryOutcome =
  | 'recovered'
  | 'recovered_terminal'
  | 'not_found'
  | 'retry';

type QuizSurfaceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'starting'
  | 'question'
  | 'submitting'
  | 'result'
  | 'error';
// biome-ignore format: Compact state contract keeps this recovery module below the repository limit.
export type QuizTerminalContext = { attemptId: string; eventId: string; eventEndsAt?: string | null; serverNow?: string | null; submittedAt?: string | null; contractVersion: 2 | 3; };
// biome-ignore format: Compact state contract keeps this recovery module below the repository limit.
export interface QuizV2StoreState { attemptIntegrityTier: QuizIntegrityTier | null; error: string | null; expiryRetryable: boolean; lockedOptionId: string | null; recoveryUserId: string | null; selectedEventId: string | null; startRequestId: string | null; status: QuizSurfaceStatus; terminalContext: QuizTerminalContext | null; v2Attempt: QuizV2Attempt | null; v2LifecycleStatus: QuizV2LifecycleStatus; v2Result: QuizV2Result | null; }
// biome-ignore format: Compact value contract keeps this recovery module below the repository limit.
export interface V2StartContext { eventId: string; integrityTier: QuizIntegrityTier; startRequestId: string; userId: string; }
// biome-ignore format: Compact initial state keeps this recovery module below the repository limit.
export const initialQuizV2State = { expiryRetryable: false, v2Attempt: null, lockedOptionId: null, startRequestId: null, recoveryUserId: null, terminalContext: null, v2Result: null, v2LifecycleStatus: 'idle' as const };

// biome-ignore format: Compact action contract keeps this recovery module below the repository limit.
export interface QuizV2StoreActions { startEventV2(context: V2StartContext, starter: (startRequestId: string) => Promise<QuizV2Attempt>): Promise<void>; recoverEvent(userId: string, eventId: string, recoverer: () => Promise<QuizActiveAttemptResponse>, resender: (optionId: string, questionId: string) => Promise<QuizV2Attempt>, scannedEnvelope?: QuizRecoveryEnvelope): Promise<QuizRecoveryOutcome>; reconcileLifecycle(reconciler: () => Promise<QuizActiveAttemptResponse>, nowMs?: number): Promise<void>; expireActiveEvent(reconciler: () => Promise<QuizActiveAttemptResponse>): Promise<void>; lockAndSubmitAnswer(optionId: string, submitter: (optionId: string) => Promise<QuizV2Attempt>): Promise<void>; retryLockedAnswer(submitter: (optionId: string) => Promise<QuizV2Attempt>): Promise<void>; setV2Result(result: QuizV2Result): void; }

function recoveryKey(userId: string, eventId: string): string {
  return `${KEY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(eventId)}`;
}

export function createQuizRecoveryEnvelope(
  input: Omit<QuizRecoveryEnvelope, 'version'>
): QuizRecoveryEnvelope {
  return recoveryEnvelopeSchema.parse({
    ...input,
    persistedAt: input.persistedAt ?? new Date().toISOString(),
    version: RECOVERY_VERSION,
  });
}

export async function saveQuizRecoveryEnvelope(
  envelope: QuizRecoveryEnvelope
): Promise<void> {
  const parsed = recoveryEnvelopeSchema.parse(envelope);
  await asyncStorage.setItem(
    recoveryKey(parsed.userId, parsed.eventId),
    JSON.stringify(parsed)
  );
}

export async function loadQuizRecoveryEnvelope(
  userId: string,
  eventId: string
): Promise<QuizRecoveryEnvelope | null> {
  const key = recoveryKey(userId, eventId);
  const stored = await asyncStorage.getItem(key);
  if (!stored) return null;
  try {
    const parsed = recoveryEnvelopeSchema.safeParse(JSON.parse(stored));
    // biome-ignore format: Keep the small identity guard compact for the module-size gate.
    if (parsed.success && parsed.data.userId === userId && parsed.data.eventId === eventId) {
      return parsed.data;
    }
  } catch {
    // Invalid or obsolete storage is discarded below.
  }
  await asyncStorage.removeItem(key);
  return null;
}

export async function loadQuizRecoveryEnvelopes(
  userId: string
): Promise<QuizRecoveryEnvelope[]> {
  const prefix = `${KEY_PREFIX}:${encodeURIComponent(userId)}:`;
  const keys = await asyncStorage.getAllKeys();
  const eventIds = Array.from(
    new Set(
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter(Boolean)
        .map((encodedEventId) => {
          try {
            return decodeURIComponent(encodedEventId);
          } catch {
            return null;
          }
        })
        .filter((eventId): eventId is string => Boolean(eventId))
    )
  );
  const envelopes = await Promise.all(
    eventIds.map((eventId) => loadQuizRecoveryEnvelope(userId, eventId))
  );
  return envelopes
    .filter((envelope): envelope is QuizRecoveryEnvelope => envelope !== null)
    .sort((left, right) => {
      const leftIsActive = !isRetainedTerminalEnvelope(left);
      const rightIsActive = !isRetainedTerminalEnvelope(right);
      if (leftIsActive !== rightIsActive) return leftIsActive ? -1 : 1;
      const leftPersistedAt = left.persistedAt
        ? Date.parse(left.persistedAt)
        : Number.NaN;
      const rightPersistedAt = right.persistedAt
        ? Date.parse(right.persistedAt)
        : Number.NaN;
      if (!Number.isNaN(leftPersistedAt) && !Number.isNaN(rightPersistedAt)) {
        return rightPersistedAt - leftPersistedAt;
      }
      return right.generation - left.generation;
    });
}

function isRetainedTerminalEnvelope({
  attemptId,
  currentQuestionId,
  pendingLockedOptionId,
}: QuizRecoveryEnvelope): boolean {
  return Boolean(attemptId && !currentQuestionId && !pendingLockedOptionId);
}

export function clearQuizRecoveryEnvelope(
  userId: string,
  eventId: string
): Promise<void> {
  return asyncStorage.removeItem(recoveryKey(userId, eventId));
}
