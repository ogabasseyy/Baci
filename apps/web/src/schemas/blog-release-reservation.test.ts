import { describe, expect, it } from 'vitest';
import {
  blogReleasePostParamsSchema,
  cancelBlogReleaseSchema,
  reserveBlogReleaseSchema,
} from './blog-release-reservation';

describe('blog-release-reservation schemas', () => {
  const validInput = {
    article_identity: 'e1000000-0000-4000-8000-000000000001',
    release_class: 'evergreen' as const,
    request_id: 'req-001',
    requested_publish_at: '2026-11-20T10:00:00.000Z',
  };

  it('validates route post UUIDs and reserve payloads with defaults', () => {
    expect(
      blogReleasePostParamsSchema.safeParse({
        id: 'd3000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(true);
    expect(
      blogReleasePostParamsSchema.safeParse({ id: 'not-a-uuid' }).success
    ).toBe(false);

    const parsed = reserveBlogReleaseSchema.parse(validInput);
    expect(parsed.policy_version).toBe('policy-2026-11');
    expect(parsed.is_low_demand_game_software).toBe(false);
  });

  it('rejects fast_track_cap > 2, invalid window_end_hour, and invalid cancel reasons', () => {
    expect(
      reserveBlogReleaseSchema.safeParse({ ...validInput, fast_track_cap: 3 })
        .success
    ).toBe(false);
    expect(
      reserveBlogReleaseSchema.safeParse({ ...validInput, window_end_hour: 24 })
        .success
    ).toBe(false);
    expect(
      reserveBlogReleaseSchema.safeParse({
        ...validInput,
        window_end_hour: 7,
        window_start_hour: 8,
      }).success
    ).toBe(false);
    expect(cancelBlogReleaseSchema.safeParse({ reason: '   ' }).success).toBe(
      false
    );
  });
});
