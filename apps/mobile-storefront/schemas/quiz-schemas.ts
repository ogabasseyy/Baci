import {
  getQuizMaximumPlaySeconds,
  QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS,
  QUIZ_DEFAULT_TIME_ZONE,
  QUIZ_FREE_ENTRY_MODE,
  QUIZ_LIVE_MAX_ATTEMPTS,
} from '@baci/shared/constants';
import { quizV2EventSchema as sharedQuizV2EventSchema } from '@baci/shared/schemas';
import { z } from 'zod';

export {
  quizV2ActiveAttemptResponseSchema,
  quizV2AttemptResponseSchema,
  quizV2QuestionSchema,
  quizV2ResultResponseSchema,
  startQuizAttemptV2RequestSchema,
} from '@baci/shared/schemas';

/** Supabase timestamptz values are ISO strings with a timezone offset. */
const quizEventDateTimeSchema = z.iso.datetime({ offset: true }).nullable();
const quizUuidSchema = z.uuid();

export const quizOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const quizQuestionSchema = z.object({
  deadlineAt: z.iso.datetime({ offset: true }),
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(quizOptionSchema).min(1),
  timeLimitSeconds: z.number().int().positive(),
  // The API returns this as a 1-based display position, not an array offset.
  index: z.number().int().positive(),
  total: z.number().int().positive(),
});

const legacyQuizPrizeProductSchema = z.strictObject({
  id: quizUuidSchema,
  imageUrl: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1),
  variantId: quizUuidSchema.nullable(),
});

const legacyQuizEventSchema = z
  .strictObject({
    contractVersion: z.literal(1).optional(),
    id: z.string().min(1),
    title: z.string().min(1),
    prizeName: z.string().min(1),
    prizeProduct: legacyQuizPrizeProductSchema.optional(),
    startsAt: quizEventDateTimeSchema,
    endsAt: quizEventDateTimeSchema,
    status: z.enum(['open', 'scheduled', 'closed']),
    questionCount: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (
      value.startsAt &&
      value.endsAt &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'endsAt must be after startsAt',
        path: ['endsAt'],
      });
    }
  })
  .transform((value) => ({
    contractVersion: 1 as const,
    endsAt: value.endsAt,
    id: value.id,
    liveWindowSeconds:
      value.startsAt && value.endsAt
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 1000
            )
          )
        : null,
    maxAttempts: QUIZ_LIVE_MAX_ATTEMPTS,
    maximumPlaySeconds: getQuizMaximumPlaySeconds(
      value.questionCount,
      QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS
    ),
    mode: 'live' as const,
    prizeName: value.prizeName,
    prizeProduct: value.prizeProduct
      ? { ...value.prizeProduct, condition: null }
      : undefined,
    questionCount: value.questionCount,
    resultsPublishedAt: null,
    rulesVersion: null,
    startsAt: value.startsAt,
    status: value.status,
    timePerQuestionSeconds: QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS,
    timeZone: QUIZ_DEFAULT_TIME_ZONE,
    title: value.title,
  }));

const quizPaginationSchema = z.strictObject({
  hasMore: z.boolean(),
  limit: z.number().int().positive(),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
});

// Keep the paging contract local to the consumer that follows it. The field
// remains optional because a one-page response need not advertise paging, but
// any response that does include it must carry the complete safe cursor shape.
export const quizV2EventSchema = sharedQuizV2EventSchema;
export const quizV2EventsResponseSchema = z.strictObject({
  contractVersion: z.literal(2),
  entryMode: z.literal(QUIZ_FREE_ENTRY_MODE),
  events: z.array(quizV2EventSchema),
  pagination: quizPaginationSchema.optional(),
  serverNow: z.iso.datetime({ offset: true }),
});

/** Parses v2 events exactly and attaches only safe defaults to legacy rows. */
export const quizEventSchema = z.union([
  quizV2EventSchema,
  legacyQuizEventSchema,
]);

const legacyQuizEventsResponseSchema = z.strictObject({
  contractVersion: z.literal(1).optional(),
  entryMode: z.literal(QUIZ_FREE_ENTRY_MODE),
  events: z.array(legacyQuizEventSchema),
  pagination: quizPaginationSchema.optional(),
  serverNow: z.iso.datetime({ offset: true }).optional(),
});

export const quizEventsResponseSchema = z.union([
  quizV2EventsResponseSchema,
  legacyQuizEventsResponseSchema,
]);

export const quizLeaderboardEntrySchema = z.strictObject({
  displayName: z.string().trim().min(1),
  isCurrentCustomer: z.boolean(),
  rank: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.string().min(1),
  submittedAt: z.string().nullable(),
  totalTimeSeconds: z.number().nonnegative().nullable(),
});

export const quizLeaderboardResponseSchema = z.strictObject({
  currentPlayer: quizLeaderboardEntrySchema.nullable(),
  entries: z.array(quizLeaderboardEntrySchema).max(100),
  participantCount: z.number().int().nonnegative().nullable(),
  status: z.enum(['published', 'live', 'live_hidden', 'unavailable']),
});

export const quizParticipantCountResponseSchema = z.strictObject({
  participantCount: z.number().int().nonnegative(),
});

export const quizAttemptSchema = z.object({
  attemptId: z.string().min(1),
  eventId: z.string().min(1),
  // Entry is free, so this is 0. Deliberately NOT z.literal(EXAM_PASS_POINTS_COST):
  // a literal would hard-fail any attempt started against a database that still
  // charges (e.g. an installed app during a deploy window, or an older build).
  examPassPointsSpent: z.number().int().nonnegative(),
  remainingLoyaltyPoints: z.number().int().nonnegative(),
  question: quizQuestionSchema,
});

export const quizPrizeConditionSchema = z.enum([
  'new',
  'used',
  'open_box',
  'refurbished',
]);

/**
 * Winning submissions carry a signed prize voucher the mobile client redeems by
 * adding the prize product to the cart. Non-winning responses omit it, so the
 * whole object is optional while nullable fields stay present as `null` when
 * unset. Mirrors the authoritative web
 * shape in `apps/web/src/schemas/quiz.ts` (`quizResultResponseSchema.prizeClaim`).
 */
export const quizPrizeClaimSchema = z.object({
  awardId: quizUuidSchema,
  productId: quizUuidSchema,
  variantId: quizUuidSchema.nullable(),
  condition: quizPrizeConditionSchema.nullable(),
  voucherToken: z.string().trim().min(1).max(512),
  cartPath: z.string().trim().min(1).max(1024),
});

export const quizResultSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.enum(['completed', 'in_progress']),
    correctAnswers: z.number().int().nonnegative(),
    totalQuestions: z.number().int().positive(),
    prizeEligible: z.boolean(),
    prizeClaim: quizPrizeClaimSchema.optional(),
    question: quizQuestionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.status === 'in_progress' && !value.question) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'In-progress quiz responses must include the next question',
        path: ['question'],
      });
    }
    if (value.correctAnswers > value.totalQuestions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'correctAnswers cannot exceed totalQuestions',
        path: ['correctAnswers'],
      });
    }
  });
