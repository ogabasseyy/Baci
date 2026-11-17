import { createHash } from 'node:crypto';
import type { ReserveBlogReleaseInput } from '@/schemas/blog-release-reservation';

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
