import { createSanitizeHtmlOptions } from '@/lib/sanitize-html-config';
import { isChannelUtility } from './review-handoff-channel-utilities';
import { parseHandoffDom } from './review-handoff-dom';
import { stripImportantModifier } from './review-handoff-important';

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
 * differently on each side of the lossy step.
 */
export function hasUnrepresentableHiddenWrapper(html: string): boolean {
  for (const element of parseHandoffDom(html).querySelectorAll('*')) {
    if (PRESERVED_TAGS.has(element.tagName.toLowerCase())) continue;
    for (const token of element.classList) {
      if (isChannelUtility(baseUtility(token))) return true;
    }
  }
  return false;
}
