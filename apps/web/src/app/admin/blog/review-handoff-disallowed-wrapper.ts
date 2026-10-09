import { createSanitizeHtmlOptions } from '@/lib/sanitize-html-config';
import { isChannelUtility } from './review-handoff-channel-utilities';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { stripImportantModifier } from './review-handoff-important';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';

// Tags the sanitizer preserves, derived from the live config so the
// check cannot drift from the allowlist. Every other tag unwraps,
// discarding its classes before the strip runs.
const CONFIGURED_TAGS = createSanitizeHtmlOptions().allowedTags;
const PRESERVED_TAGS = new Set(
  (Array.isArray(CONFIGURED_TAGS) ? CONFIGURED_TAGS : []).map((tag) =>
    tag.toLowerCase()
  )
);

function baseUtility(token: string): string {
  const segments = stripImportantModifier(token).split(':');
  return segments[segments.length - 1] ?? '';
}

/**
 * Whether markup hides or shows content through a tag sanitization
 * unwraps. Runs pre-sanitize on converted markup (hidden attributes
 * and styles are classes by then): the strip evaluates what remains
 * after unwrapping, so a channel marker on a discarded tag reads
 * differently on each side of the lossy step. Comments strip first.
 */
export function hasUnrepresentableHiddenWrapper(html: string): boolean {
  for (const match of stripHtmlComments(html).matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (PRESERVED_TAGS.has(match[2].toLowerCase())) continue;
    for (const { name, value } of tagAttributes(match[0])) {
      if (name !== 'class') continue;
      for (const token of value.split(/\s+/)) {
        if (token !== '' && isChannelUtility(baseUtility(token))) return true;
      }
    }
  }
  return false;
}
