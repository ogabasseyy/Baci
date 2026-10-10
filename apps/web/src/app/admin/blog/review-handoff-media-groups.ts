import { parseHandoffDom } from './review-handoff-dom';
import { isNeverMatchingMediaQuery } from './review-handoff-media-query';

export type MediaCandidateGroup = {
  // Open tags whose URLs count: every img (standalone or picture-bound,
  // since the editor drops src-less images on mount whatever picture
  // sources supply) plus picture sources preceding the group's img
  // with an applicable type and media value. Sources after the img,
  // inapplicable sources, and pictures without media contribute nothing.
  // Tags serialize from the parsed DOM, so attribute quoting and case
  // are normalized while values round-trip exactly.
  tags: string[];
  hasMedia: boolean;
};

// Image MIME types browsers universally render. Anything else is
// skipped when selecting a picture resource, so it contributes no
// candidate here either.
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
]);

function isApplicableSource(source: Element): boolean {
  // Browsers skip sources with unsupported types. In picture context
  // only supported image MIME types are meaningful; anything else
  // (or an empty type) contributes no candidate. A provably
  // never-matching media value skips the same way; any other media
  // value is assumed applicable, since matching it requires a
  // viewport the validator has not.
  const type = source.getAttribute('type');
  if (type !== null) {
    const essence = type.split(';')[0].trim().toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(essence)) return false;
  }
  const media = source.getAttribute('media');
  if (media !== null && isNeverMatchingMediaQuery(media)) return false;
  return true;
}

/**
 * Group img and picture-bound source tags by selectable resource. Comments
 * and raw-text blocks render nothing, so media hidden inside them forms no
 * group. An img wrapped in another element inside a picture is not
 * associated with the picture sources, so it stands alone under the
 * singleton rule instead of joining the picture group. Only preceding
 * applicable source siblings participate in selecting the resource for
 * the img: sources after the group's img, and sources with inapplicable
 * types, are ignored entirely. Pictures without media elements are inert,
 * not broken.
 */
export function groupMediaElements(html: string): MediaCandidateGroup[] {
  const doc = parseHandoffDom(html);
  const groups: MediaCandidateGroup[] = [];
  // Document order keeps group sequence identical to tag-encounter
  // order: a picture opens its group before any nested singleton.
  for (const element of doc.querySelectorAll('picture,img')) {
    if (element.tagName.toLowerCase() === 'picture') {
      const group: MediaCandidateGroup = { tags: [], hasMedia: false };
      groups.push(group);
      let imgSeen = false;
      for (const child of element.children) {
        const childName = child.tagName.toLowerCase();
        if (childName === 'source') {
          if (!imgSeen && isApplicableSource(child)) {
            group.hasMedia = true;
            group.tags.push(child.outerHTML);
          }
        } else if (childName === 'img') {
          group.hasMedia = true;
          group.tags.push(child.outerHTML);
          imgSeen = true;
        }
      }
      continue;
    }
    // Direct picture children already joined above; anything else —
    // standalone, nested, or orphaned by closes — stands alone.
    const parent = element.parentElement;
    if (parent !== null && parent.tagName.toLowerCase() === 'picture') {
      continue;
    }
    groups.push({ tags: [element.outerHTML], hasMedia: true });
  }
  return groups;
}
