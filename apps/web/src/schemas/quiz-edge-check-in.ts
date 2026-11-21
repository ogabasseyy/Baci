import { z } from 'zod';

export const quizEdgeCheckInParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const quizEdgeCheckInRequestSchema = z.object({
  acceptedRulesVersion: z.string().trim().min(1).max(64),
  termsAccepted: z.boolean(),
  checkInRequestId: z.string().uuid(),
  appVersion: z.string().trim().min(1).max(64),
  platform: z.enum(['android', 'ios', 'web']),
  integrityTier: z
    .enum(['basic', 'device', 'strong', 'unknown'])
    .default('unknown'),
  expectedUserId: z.string().uuid().optional(),
});

export type QuizEdgeCheckInRequest = z.infer<
  typeof quizEdgeCheckInRequestSchema
>;

export const quizEdgeAdmissionRpcResultSchema = z.object({
  admissionId: z.string().uuid(),
  eventId: z.string().uuid(),
  merchantId: z.string().uuid(),
  customerId: z.string().uuid(),
  userId: z.string().uuid(),
  roomId: z.string().trim().min(1),
  roomIndex: z.number().int().nonnegative(),
  leaderboardUsername: z.string().trim().min(1),
  maxAttempts: z.number().int().positive(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  rulesVersion: z.string().trim().min(1),
  mode: z.enum(['live', 'test']),
  reused: z.boolean(),
});

export type QuizEdgeAdmissionRpcResult = z.infer<
  typeof quizEdgeAdmissionRpcResultSchema
>;
