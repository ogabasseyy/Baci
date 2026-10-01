import { z } from 'zod';

/** Query params for GET /api/quiz/leaderboard. */
export const quizLeaderboardQuerySchema = z.object({
  eventId: z.uuid(),
});

export const quizLeaderboardStatusSchema = z.enum([
  'published',
  'live',
  'live_hidden',
  'unavailable',
]);

export const quizLeaderboardEntrySchema = z.object({
  displayName: z.string().trim().min(1),
  isCurrentCustomer: z.boolean(),
  rank: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.string().min(1),
  submittedAt: z.string().min(1).nullable(),
  totalTimeSeconds: z.number().nonnegative().nullable(),
});

export type QuizLeaderboardEntry = z.infer<typeof quizLeaderboardEntrySchema>;

export const quizLeaderboardResponseSchema = z.object({
  currentPlayer: quizLeaderboardEntrySchema.nullable(),
  entries: z.array(quizLeaderboardEntrySchema).max(100),
  participantCount: z.number().int().nonnegative().nullable(),
  status: quizLeaderboardStatusSchema,
});

export type QuizLeaderboardResponse = z.infer<
  typeof quizLeaderboardResponseSchema
>;

/** Safe row returned inside get_quiz_leaderboard_public_v2's JSON projection. */
export const quizLeaderboardRowSchema = z.object({
  customer_name: z.string().trim().min(1),
  is_current_customer: z.boolean().nullable(),
  rank: z.union([z.number(), z.string()]),
  score: z.number().nullable(),
  status: z.string().nullable(),
  submitted_at: z.string().nullable(),
  total_time_seconds: z.number().nullable(),
});

export type QuizLeaderboardRow = z.infer<typeof quizLeaderboardRowSchema>;

export const quizLeaderboardProjectionSchema = z.object({
  current_player: quizLeaderboardRowSchema.nullable(),
  entries: z.array(quizLeaderboardRowSchema).max(100),
  status: quizLeaderboardStatusSchema,
});
