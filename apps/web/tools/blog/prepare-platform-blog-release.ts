import { toApiPayload } from '../../src/app/admin/blog/blog-api-payload';
import { parseReviewHandoff } from '../../src/app/admin/blog/parse-review-handoff';
import {
  validateBlogDiscoverImageReadiness,
  validateBlogImageVariantIntegrity,
} from '../../src/lib/blog-discover-readiness';
import {
  calculateReadingTime,
  calculateWordCount,
} from '../../src/lib/blog-utils';
import {
  createPostSchema,
  sanitizeBlogPostData,
} from '../../src/lib/validations/blog';
import { normalizePlatformReleaseContent } from './normalize-platform-release-content';

/** Operator-only preparation; the publisher receives no arbitrary payload input. */
export function preparePlatformBlogRelease(input: unknown) {
  const normalized =
    input &&
    typeof input === 'object' &&
    'content_html' in input &&
    typeof input.content_html === 'string'
      ? {
          ...input,
          content_html: normalizePlatformReleaseContent(input.content_html),
        }
      : input;
  const form = parseReviewHandoff(normalized);
  const payload = createPostSchema.parse(
    sanitizeBlogPostData(
      toApiPayload({
        ...form,
        status: 'published',
        featured_image_alt_edited: true,
      })
    )
  );
  for (const result of [
    validateBlogImageVariantIntegrity(payload, { kind: 'platform' }),
    validateBlogDiscoverImageReadiness(payload, { kind: 'platform' }),
  ]) {
    if (!result.ready) throw new Error(result.code);
  }
  return {
    ...payload,
    reading_time_minutes: calculateReadingTime(payload.content),
    word_count: calculateWordCount(payload.content),
  };
}
