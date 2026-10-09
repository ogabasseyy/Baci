import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { hasOpenAttribute } from './review-handoff-open-attribute';
import { stripHtmlComments } from './strip-html-comments';

/**
 * Whether markup hides content behind a closed disclosure control.
 * Neither the sanitizer allowlist nor the editor extensions
 * represent details/summary, so sanitization unwraps the control
 * and stores collapsed content as permanently visible text. An
 * `open` details element renders its content in the source document
 * already, so only closed disclosures drift. Comments strip first:
 * a details opener inside comment text is not markup.
 */
export function hasClosedDisclosure(html: string): boolean {
  for (const match of stripHtmlComments(html).matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (match[2].toLowerCase() !== 'details') continue;
    if (!hasOpenAttribute(match[0])) return true;
  }
  return false;
}
