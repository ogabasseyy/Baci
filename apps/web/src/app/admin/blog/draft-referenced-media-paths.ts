import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { PlatformAdminBlogFormState } from './blog-types';
import { matchMediaElements } from './review-handoff-media-elements';
import { splitSrcsetCandidates } from './review-handoff-srcset';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

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
  // Comments and raw-text blocks render nothing, so references hidden
  // inside them must not retain objects.
  const content = stripRawTextBlocks(stripHtmlComments(draft.content));
  for (const match of matchMediaElements(content)) {
    for (const { name, value } of tagAttributes(match[0])) {
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
  return new Set(
    urls
      .filter((url): url is string => typeof url === 'string')
      .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
      .filter((path): path is string => path !== null)
  );
}
