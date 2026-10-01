import {
  quizV2ActiveAttemptResponseSchema,
  quizV2AttemptResponseSchema,
  quizV2ResultResponseSchema,
} from '@baci/shared/schemas';
import { z } from 'zod';

const rawResultSchema = z.strictObject({
  attemptId: z.uuid(),
  availability: z.enum(['pending', 'final', 'unavailable']),
  availableAt: z.iso.datetime({ offset: true }).nullable().optional(),
  claimMetadata: z
    .strictObject({
      awardId: z.uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
  rank: z.number().int().positive().optional(),
  reason: z.enum(['event_cancelled', 'not_found', 'tester_revoked']).optional(),
  score: z.number().int().nonnegative().optional(),
  totalQuestions: z.number().int().positive().max(50).optional(),
});

function pickAttempt(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  return {
    attemptId: row.attemptId,
    eventEndsAt: row.eventEndsAt,
    eventId: row.eventId,
    question: row.question,
    resultsAvailableAt: row.resultsAvailableAt,
    resumed: row.resumed,
    serverNow: row.serverNow,
    status: row.status,
    submittedAt: row.submittedAt,
  };
}

export function parseQuizV2Attempt(value: unknown) {
  return quizV2AttemptResponseSchema.safeParse(pickAttempt(value));
}

export function parseQuizV2ActiveAttempt(value: unknown) {
  if (!value || typeof value !== 'object') {
    return quizV2ActiveAttemptResponseSchema.safeParse(value);
  }
  const row = value as Record<string, unknown>;
  return quizV2ActiveAttemptResponseSchema.safeParse({
    attempt: row.attempt === undefined ? undefined : pickAttempt(row.attempt),
    attemptId: row.attemptId,
    availability: row.availability,
    eventEndsAt: row.eventEndsAt,
    serverNow: row.serverNow,
    submittedAt: row.submittedAt,
  });
}

export function parseQuizV2RawResult(value: unknown) {
  return rawResultSchema.safeParse(value);
}

export function parseQuizV2PublicResult(value: unknown) {
  return quizV2ResultResponseSchema.safeParse(value);
}
