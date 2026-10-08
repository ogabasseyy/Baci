import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';

/**
 * Whether markup hides content behind a closed disclosure control.
 * Neither the sanitizer allowlist nor the editor extensions
 * represent details/summary, so sanitization unwraps the control
 * and stores collapsed content as permanently visible text. An
 * `open` details element renders its content in the source document
 * already, so only closed disclosures drift.
 */
function hasOpenAttribute(tag: string): boolean {
  // `open` is a boolean attribute: any presence (even `open=""` or
  // `open="false"`) renders the disclosure expanded. Valueless
  // attributes never reach tagAttributes, so match the raw tag with
  // quoted values blanked: data-open and a title mentioning "open"
  // must not count.
  const unquoted = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  return /(?:\s|^)open(?:\s*=\s*(?:""|[^\s>]+))?(?=[\s/>])/i.test(unquoted);
}

export function hasClosedDisclosure(html: string): boolean {
  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (match[2].toLowerCase() !== 'details') continue;
    if (!hasOpenAttribute(match[0])) return true;
  }
  return false;
}
