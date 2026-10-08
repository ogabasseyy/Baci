import { matchMediaElements } from './review-handoff-media-elements';
import { isNeverMatchingMediaQuery } from './review-handoff-media-query';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

export type MediaCandidateGroup = {
  // Open tags whose URLs count: every img (standalone or picture-bound,
  // since the editor drops src-less images on mount whatever picture
  // sources supply) plus picture sources preceding the group's img
  // with an applicable type and media value. Sources after the img,
  // inapplicable sources, and pictures without media contribute nothing.
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

function isApplicableSource(tag: string): boolean {
  // Browsers skip sources with unsupported types. In picture context
  // only supported image MIME types are meaningful; anything else
  // (or an empty type) contributes no candidate. A provably
  // never-matching media value skips the same way; any other media
  // value is assumed applicable, since matching it requires a
  // viewport the validator has not.
  let applicable = true;
  for (const { name, value } of tagAttributes(tag)) {
    if (name === 'type') {
      const essence = value.split(';')[0].trim().toLowerCase();
      if (!SUPPORTED_IMAGE_MIME_TYPES.has(essence)) applicable = false;
    } else if (name === 'media') {
      if (isNeverMatchingMediaQuery(value)) applicable = false;
    }
  }
  return applicable;
}

type OpenGroup = MediaCandidateGroup & { imgSeen: boolean };

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
  const withoutComments = stripRawTextBlocks(stripHtmlComments(html));
  const groups: OpenGroup[] = [];
  const pictureStack: OpenGroup[] = [];
  for (const match of matchMediaElements(withoutComments)) {
    const tag = match[0];
    if (/^<picture\b/i.test(tag)) {
      const group: OpenGroup = { tags: [], hasMedia: false, imgSeen: false };
      groups.push(group);
      pictureStack.push(group);
      continue;
    }
    if (/^<\/picture\s*>/i.test(tag)) {
      pictureStack.pop();
      continue;
    }
    const isImg = /^<img\b/i.test(tag);
    const pictureBound =
      pictureStack.length > 0 && (!isImg || match.directPictureChild);
    let group: OpenGroup;
    if (pictureBound) {
      group = pictureStack[pictureStack.length - 1];
    } else {
      group = { tags: [], hasMedia: true, imgSeen: false };
      groups.push(group);
    }
    if (isImg) {
      group.hasMedia = true;
      group.tags.push(tag);
      group.imgSeen = true;
    } else if (!group.imgSeen && isApplicableSource(tag)) {
      group.hasMedia = true;
      group.tags.push(tag);
    }
  }
  return groups;
}
