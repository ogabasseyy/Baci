import { createHash } from 'node:crypto';
import { z } from 'zod';

export const blogReleasePostParamsSchema = z.object({
  id: z.string().uuid('Invalid post ID'),
});

export const reserveBlogReleaseSchema = z.object({
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
  window_end_hour: z.number().int().min(1).max(24).optional(),
});

export const cancelBlogReleaseSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});

export type ReserveBlogReleaseInput = z.infer<typeof reserveBlogReleaseSchema>;

export function buildReleaseReservationPayloadDigest(
  merchantId: string,
  postId: string,
  input: ReserveBlogReleaseInput
): string {
  const canonicalPayload = JSON.stringify({
    article_identity: input.article_identity,
    category: input.category ?? null,
    daily_cap: input.daily_cap ?? null,
    event_published_at: input.event_published_at ?? null,
    evergreen_min_reserve: input.evergreen_min_reserve ?? null,
    fast_track_cap: input.fast_track_cap ?? null,
    is_low_demand_game_software: input.is_low_demand_game_software,
    merchant_id: merchantId,
    min_spacing_minutes: input.min_spacing_minutes ?? null,
    policy_version: input.policy_version,
    post_id: postId,
    release_class: input.release_class,
    requested_publish_at: input.requested_publish_at,
    task_type: input.task_type ?? null,
    window_end_hour: input.window_end_hour ?? null,
    window_start_hour: input.window_start_hour ?? null,
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
}
