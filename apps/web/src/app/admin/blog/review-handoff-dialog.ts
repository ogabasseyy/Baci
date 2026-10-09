import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { hasOpenAttribute } from './review-handoff-open-attribute';
import { stripHtmlComments } from './strip-html-comments';

/**
 * Whether markup hides content behind a closed dialog. Neither the
 * sanitizer allowlist nor the editor extensions represent dialog,
 * so sanitization unwraps the control and stores hidden content as
 * permanently visible text. An `open` dialog renders its content
 * in the source document already, so only closed dialogs drift.
 * Comments strip first: a dialog opener inside comment text is not
 * markup.
 */
export function hasClosedDialog(html: string): boolean {
  for (const match of stripHtmlComments(html).matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (match[2].toLowerCase() !== 'dialog') continue;
    if (!hasOpenAttribute(match[0])) return true;
  }
  return false;
}
