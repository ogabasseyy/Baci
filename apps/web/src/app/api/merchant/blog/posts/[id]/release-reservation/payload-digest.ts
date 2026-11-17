import { createHash } from 'node:crypto';
import type { ReserveBlogReleaseInput } from '@/schemas/blog-release-reservation';

const DEFAULT_DAILY_CAP = 3;
const DEFAULT_FAST_TRACK_CAP = 2;
const DEFAULT_EVERGREEN_MIN_RESERVE = 1;
const DEFAULT_MIN_SPACING_MINUTES = 30;
const DEFAULT_WINDOW_START_HOUR = 8;
const DEFAULT_WINDOW_END_HOUR = 20;

export function buildReleaseReservationPayloadDigest(
  merchantId: string,
  postId: string,
  input: ReserveBlogReleaseInput
): string {
  const canonicalPayload = JSON.stringify({
    article_identity: input.article_identity,
    category: input.category ?? null,
    daily_cap: input.daily_cap ?? DEFAULT_DAILY_CAP,
    event_published_at: input.event_published_at
      ? new Date(input.event_published_at).toISOString()
      : null,
    evergreen_min_reserve:
      input.evergreen_min_reserve ?? DEFAULT_EVERGREEN_MIN_RESERVE,
    fast_track_cap: input.fast_track_cap ?? DEFAULT_FAST_TRACK_CAP,
    is_low_demand_game_software: input.is_low_demand_game_software,
    merchant_id: merchantId,
    min_spacing_minutes:
      input.min_spacing_minutes ?? DEFAULT_MIN_SPACING_MINUTES,
    policy_version: input.policy_version,
    post_id: postId,
    release_class: input.release_class,
    requested_publish_at: new Date(input.requested_publish_at).toISOString(),
    task_type: input.task_type ?? null,
    window_end_hour: input.window_end_hour ?? DEFAULT_WINDOW_END_HOUR,
    window_start_hour: input.window_start_hour ?? DEFAULT_WINDOW_START_HOUR,
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
}
