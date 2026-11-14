import {
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
} from '@baci/shared/constants';
import { z } from 'zod';
import { quizUuidSchema } from './quiz-schema-primitives';

export const quizEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).prefault(20),
    merchantId: quizUuidSchema.optional(),
    merchantSlug: z.string().trim().min(1).max(120).optional(),
    offset: z.coerce.number().int().min(0).prefault(0),
    // v2 only: return every active/scheduled event (server-side paging).
    current: z.literal('1').optional(),
  })
  .refine((value) => value.merchantId || value.merchantSlug, {
    path: ['merchantId'],
    error: 'merchantId or merchantSlug is required',
  })
  .refine((value) => !(value.merchantId && value.merchantSlug), {
    path: ['merchantId'],
    error: 'provide either merchantId or merchantSlug, not both',
  });

/** Normalized request-header contract for v2 player API calls. */
export const quizContractVersionHeaderSchema = z.strictObject({
  [QUIZ_CONTRACT_HEADER.toLowerCase()]: z.coerce
    .number()
    .int()
    .refine((value) => value === QUIZ_CONTRACT_VERSION, {
      message: `Unsupported quiz contract version; expected ${QUIZ_CONTRACT_VERSION}`,
    }),
});

export const quizAttemptParamsSchema = z.object({
  attemptId: quizUuidSchema,
});

export const quizActiveAttemptQuerySchema = z.strictObject({
  eventId: quizUuidSchema,
});
