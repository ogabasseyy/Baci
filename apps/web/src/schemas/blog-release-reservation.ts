import { z } from 'zod';

export const blogReleasePostParamsSchema = z.object({
  id: z.string().uuid('Invalid post ID'),
});

export const reserveBlogReleaseSchema = z
  .object({
    article_identity: z.string().uuid('Invalid article_identity UUID'),
    request_id: z.string().trim().min(1).max(200),
    policy_version: z.string().trim().min(1).max(80).default('policy-2026-11'),
    release_class: z.enum(['evergreen', 'fast_track_news', 'standard']),
    requested_publish_at: z.iso.datetime({ offset: true }),
    task_type: z.string().trim().max(100).optional().nullable(),
    category: z.string().trim().max(100).optional().nullable(),
    is_low_demand_game_software: z.boolean().default(false),
    event_published_at: z.iso.datetime({ offset: true }).optional().nullable(),
    daily_cap: z.number().int().min(0).max(50).optional(),
    fast_track_cap: z.number().int().min(0).max(2).optional(),
    evergreen_min_reserve: z.number().int().min(0).max(50).optional(),
    min_spacing_minutes: z.number().int().min(0).max(1440).optional(),
    window_start_hour: z.number().int().min(0).max(23).optional(),
    window_end_hour: z.number().int().min(0).max(23).optional(),
  })
  .superRefine((data, ctx) => {
    const effectiveStart = data.window_start_hour ?? 8;
    const effectiveEnd = data.window_end_hour ?? 20;
    if (effectiveEnd < effectiveStart) {
      ctx.addIssue({
        code: 'custom',
        message: 'window_end_hour must be >= window_start_hour',
        path: ['window_end_hour'],
      });
    }
  });

export const cancelBlogReleaseSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});

export type ReserveBlogReleaseInput = z.infer<typeof reserveBlogReleaseSchema>;
