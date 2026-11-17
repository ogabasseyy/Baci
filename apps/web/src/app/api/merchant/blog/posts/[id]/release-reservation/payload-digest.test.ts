import { describe, expect, it } from 'vitest';
import { reserveBlogReleaseSchema } from '@/schemas/blog-release-reservation';
import { buildReleaseReservationPayloadDigest } from './payload-digest';

describe('buildReleaseReservationPayloadDigest', () => {
  const validInput = reserveBlogReleaseSchema.parse({
    article_identity: 'e1000000-0000-4000-8000-000000000001',
    release_class: 'evergreen',
    request_id: 'req-001',
    requested_publish_at: '2026-11-20T10:00:00.000Z',
  });

  it('computes deterministic 64-char sha256 payload digests', () => {
    const d1 = buildReleaseReservationPayloadDigest(
      'merchant-1',
      'post-1',
      validInput
    );
    const d2 = buildReleaseReservationPayloadDigest(
      'merchant-1',
      'post-1',
      validInput
    );
    const d3 = buildReleaseReservationPayloadDigest('merchant-1', 'post-1', {
      ...validInput,
      requested_publish_at: '2026-11-21T10:00:00.000Z',
    });

    expect(d1).toMatch(/^[a-f0-9]{64}$/);
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);

    const withExplicitDefaults = reserveBlogReleaseSchema.parse({
      article_identity: 'e1000000-0000-4000-8000-000000000001',
      daily_cap: 3,
      evergreen_min_reserve: 1,
      fast_track_cap: 2,
      min_spacing_minutes: 30,
      release_class: 'evergreen',
      request_id: 'req-001',
      requested_publish_at: '2026-11-20T10:00:00+00:00',
      window_end_hour: 20,
      window_start_hour: 8,
    });
    expect(
      buildReleaseReservationPayloadDigest(
        'merchant-1',
        'post-1',
        withExplicitDefaults
      )
    ).toBe(d1);
    const withBlankOptionals = reserveBlogReleaseSchema.parse({
      article_identity: 'e1000000-0000-4000-8000-000000000001',
      category: '   ',
      release_class: 'evergreen',
      request_id: 'req-001',
      requested_publish_at: '2026-11-20T10:00:00.000Z',
      task_type: '',
    });
    expect(
      buildReleaseReservationPayloadDigest(
        'merchant-1',
        'post-1',
        withBlankOptionals
      )
    ).toBe(d1);
  });
});
