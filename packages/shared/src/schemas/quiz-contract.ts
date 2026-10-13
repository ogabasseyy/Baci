import { z } from 'zod';
import {
  isQuizWindowSecondsAllowed,
  QUIZ_CONTRACT_VERSION,
  QUIZ_FREE_ENTRY_MODE,
  QUIZ_LIVE_MAX_ATTEMPTS,
  QUIZ_MAX_LOGICAL_QUESTIONS,
  QUIZ_MAX_TIME_PER_QUESTION_SECONDS,
  QUIZ_MIN_TIME_PER_QUESTION_SECONDS,
  QUIZ_MODES,
  QUIZ_TEST_MAX_MAX_ATTEMPTS,
} from '../constants/quiz';

const quizIdSchema = z.string().trim().min(1);
const quizUuidSchema = z.uuid();
const quizDateTimeSchema = z.iso.datetime({ offset: true });

export const quizModeSchema = z.enum(QUIZ_MODES);
export const quizContractVersionSchema = z.literal(QUIZ_CONTRACT_VERSION);
export const quizPrizeConditionSchema = z.enum([
  'new',
  'used',
  'open_box',
  'refurbished',
]);

export const quizV2EventStatusSchema = z.enum([
  'scheduled',
  'active',
  'finalizing',
  'completed',
  'cancelled',
]);

const quizV2QuestionOptionSchema = z.strictObject({
  id: quizIdSchema,
  label: quizIdSchema,
});

export const quizV2QuestionSchema = z.strictObject({
  deadlineAt: quizDateTimeSchema,
  id: quizIdSchema,
  index: z.int().positive(),
  issuedAt: quizDateTimeSchema,
  options: z.array(quizV2QuestionOptionSchema).min(1),
  prompt: quizIdSchema,
  timeLimitSeconds: z
    .int()
    .min(QUIZ_MIN_TIME_PER_QUESTION_SECONDS)
    .max(QUIZ_MAX_TIME_PER_QUESTION_SECONDS),
  total: z.int().positive().max(QUIZ_MAX_LOGICAL_QUESTIONS),
});

export const quizV2EventSchema = z
  .strictObject({
    contractVersion: quizContractVersionSchema,
    endsAt: quizDateTimeSchema,
    id: quizIdSchema,
    liveWindowSeconds: z.int().positive(),
    maxAttempts: z
      .int()
      .min(QUIZ_LIVE_MAX_ATTEMPTS)
      .max(QUIZ_TEST_MAX_MAX_ATTEMPTS),
    maximumPlaySeconds: z.int().positive(),
    mode: quizModeSchema,
    prizeName: quizIdSchema,
    prizeProduct: z.strictObject({
      condition: quizPrizeConditionSchema.nullable(),
      id: quizUuidSchema,
      imageUrl: z.string().trim().min(1).nullable(),
      name: quizIdSchema,
      variantId: quizUuidSchema.nullable(),
    }),
    questionCount: z.int().positive().max(QUIZ_MAX_LOGICAL_QUESTIONS),
    resultsPublishedAt: quizDateTimeSchema.nullable(),
    rulesVersion: quizIdSchema,
    startsAt: quizDateTimeSchema,
    status: quizV2EventStatusSchema,
    timePerQuestionSeconds: z
      .int()
      .min(QUIZ_MIN_TIME_PER_QUESTION_SECONDS)
      .max(QUIZ_MAX_TIME_PER_QUESTION_SECONDS),
    timeZone: z.string().trim().min(1).max(100),
    title: quizIdSchema,
  })
  .superRefine((value, context) => {
    if (value.mode === 'live' && value.maxAttempts !== QUIZ_LIVE_MAX_ATTEMPTS) {
      context.addIssue({
        code: 'custom',
        message: 'Live v2 events permit exactly one attempt',
        path: ['maxAttempts'],
      });
    }
    if (
      value.maximumPlaySeconds !==
      value.questionCount * value.timePerQuestionSeconds
    ) {
      context.addIssue({
        code: 'custom',
        message: 'maximumPlaySeconds must match the configured quiz duration',
        path: ['maximumPlaySeconds'],
      });
    }

    const startsAt = Date.parse(value.startsAt);
    const endsAt = Date.parse(value.endsAt);
    const derivedWindowSeconds = (endsAt - startsAt) / 1000;
    if (endsAt <= startsAt) {
      context.addIssue({
        code: 'custom',
        message: 'endsAt must be after startsAt',
        path: ['endsAt'],
      });
      return;
    }
    if (value.liveWindowSeconds !== derivedWindowSeconds) {
      context.addIssue({
        code: 'custom',
        message: 'liveWindowSeconds must match the event timestamps',
        path: ['liveWindowSeconds'],
      });
    }
    if (
      !isQuizWindowSecondsAllowed(
        value.mode,
        value.questionCount,
        value.timePerQuestionSeconds,
        value.liveWindowSeconds
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The event window is outside the allowed timing bounds',
        path: ['liveWindowSeconds'],
      });
    }
  });

const quizPaginationSchema = z.strictObject({
  hasMore: z.boolean(),
  limit: z.int().positive(),
  nextOffset: z.int().nonnegative().nullable(),
  offset: z.int().nonnegative(),
});

export const quizV2EventsResponseSchema = z.strictObject({
  contractVersion: quizContractVersionSchema,
  entryMode: z.literal(QUIZ_FREE_ENTRY_MODE),
  events: z.array(quizV2EventSchema),
  pagination: quizPaginationSchema.optional(),
  serverNow: quizDateTimeSchema,
});

export const quizV2AttemptStatusSchema = z.enum([
  'in_progress',
  'submitted_pending_results',
  'completed',
  'event_cancelled',
]);

export const quizV2AttemptResponseSchema = z
  .strictObject({
    attemptId: quizIdSchema,
    eventEndsAt: quizDateTimeSchema,
    eventId: quizIdSchema,
    question: quizV2QuestionSchema.optional(),
    resultsAvailableAt: quizDateTimeSchema.nullable(),
    resumed: z.boolean().optional(),
    serverNow: quizDateTimeSchema,
    status: quizV2AttemptStatusSchema,
    submittedAt: quizDateTimeSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.status === 'in_progress' && !value.question) {
      context.addIssue({
        code: 'custom',
        message: 'In-progress attempts must include the issued question',
        path: ['question'],
      });
    }
    if (value.status !== 'in_progress' && value.question) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal attempts must not include an issued question',
        path: ['question'],
      });
    }
  });

export const quizV2ActiveAttemptResponseSchema = z
  .strictObject({
    attempt: quizV2AttemptResponseSchema.optional(),
    attemptId: quizIdSchema.optional(),
    availability: z.enum([
      'none',
      'active',
      'pending_results',
      'cancelled',
      'unavailable',
    ]),
    eventEndsAt: quizDateTimeSchema.nullable(),
    serverNow: quizDateTimeSchema,
    submittedAt: quizDateTimeSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.availability === 'active') {
      if (value.attempt?.status !== 'in_progress') {
        context.addIssue({
          code: 'custom',
          message:
            'Active availability requires a resumable in-progress attempt',
          path: ['attempt'],
        });
      }
      if (!value.eventEndsAt) {
        context.addIssue({
          code: 'custom',
          message: 'Active availability requires the event end time',
          path: ['eventEndsAt'],
        });
      }
    }
    if (value.availability === 'cancelled' && value.attempt) {
      context.addIssue({
        code: 'custom',
        message: 'Cancelled availability must not expose attempt details',
        path: ['attempt'],
      });
    }
  });

const quizV2PrizeClaimSchema = z.strictObject({
  awardId: quizUuidSchema,
  cartPath: z.string().trim().min(1).max(1024),
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']).nullable(),
  productId: quizUuidSchema,
  variantId: quizUuidSchema.nullable(),
  voucherToken: z.string().trim().min(1).max(512),
});

const quizV2FinalResultSchema = z.strictObject({
  attemptId: quizIdSchema,
  availability: z.literal('final'),
  availableAt: quizDateTimeSchema,
  claim: z
    .strictObject({
      expiresAt: quizDateTimeSchema,
      token: z.string().trim().min(1).max(2048),
    })
    .optional(),
  prizeClaim: quizV2PrizeClaimSchema.optional(),
  rank: z.int().positive(),
  score: z.int().nonnegative(),
  totalQuestions: z.int().positive().max(QUIZ_MAX_LOGICAL_QUESTIONS),
});

const quizV2PendingResultSchema = z.strictObject({
  attemptId: quizIdSchema,
  availability: z.literal('pending'),
  availableAt: quizDateTimeSchema.nullable(),
});

const quizV2UnavailableResultSchema = z.strictObject({
  attemptId: quizIdSchema,
  availability: z.literal('unavailable'),
  reason: z.enum(['event_cancelled', 'not_found', 'tester_revoked']).optional(),
});

/** Result states deliberately separate unpublished responses from scores/ranks. */
export const quizV2ResultResponseSchema = z.discriminatedUnion('availability', [
  quizV2FinalResultSchema,
  quizV2PendingResultSchema,
  quizV2UnavailableResultSchema,
]);

export const startQuizAttemptV2RequestSchema = z.strictObject({
  acceptedRulesVersion: quizIdSchema,
  appVersion: z.string().trim().min(1).max(100),
  deviceFingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  entryMode: z.literal('free-v1'),
  eventId: quizUuidSchema,
  expectedUserId: quizIdSchema.optional(),
  integrityTier: z.enum(['basic', 'device', 'strong']),
  platform: z.enum(['android', 'ios', 'web']),
  startRequestId: quizUuidSchema,
  termsAccepted: z.literal(true),
});

export type QuizModeContract = z.infer<typeof quizModeSchema>;
export type QuizV2Event = z.infer<typeof quizV2EventSchema>;
export type QuizV2AttemptResponse = z.infer<typeof quizV2AttemptResponseSchema>;
export type QuizV2ResultResponse = z.infer<typeof quizV2ResultResponseSchema>;
export type StartQuizAttemptV2Request = z.infer<
  typeof startQuizAttemptV2RequestSchema
>;
