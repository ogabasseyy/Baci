import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { PlatformAdminBlogFormState } from './blog-types';
import { groupMediaElements } from './review-handoff-media-groups';
import { splitSrcsetCandidates } from './review-handoff-srcset';
import { tagAttributes } from './review-handoff-tag-attributes';

type DraftMediaFields = Pick<
  PlatformAdminBlogFormState,
  'content' | 'featured_image_url' | 'featured_image_variants'
>;

/**
 * Managed storage paths referenced by a handoff draft: the cover, its
 * variants, and every image the article body embeds. Session-upload
 * cleanup retains these paths and deletes the rest.
 */
export function draftReferencedMediaPaths(
  draft: DraftMediaFields
): Set<string> {
  const urls: unknown[] = [
    draft.featured_image_url,
    ...Object.values(draft.featured_image_variants),
  ];
  // Only selectable resources retain objects: grouping applies the
  // same picture ordering and applicability rules as media validation,
  // so inert sources (after the img, inapplicable type/media) and
  // references hidden in comments or raw-text blocks retain nothing.
  for (const { tags } of groupMediaElements(draft.content)) {
    for (const tag of tags) {
      for (const { name, value } of tagAttributes(tag)) {
        if (name === 'src') {
          urls.push(value);
          continue;
        }
        if (name === 'srcset') {
          // A srcset URL runs to the first whitespace; descriptors,
          // commas, and data: payloads never contain any.
          for (const candidate of splitSrcsetCandidates(value)) {
            urls.push(candidate.split(/\s+/)[0]);
          }
        }
      }
    }
  }
  return new Set(
    urls
      .filter((url): url is string => typeof url === 'string')
      .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
      .filter((path): path is string => path !== null)
  );
}
