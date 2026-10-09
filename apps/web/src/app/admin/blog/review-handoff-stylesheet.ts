import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';

const STYLE_CLOSE_PATTERN = /<\/style[\s>]/i;
const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

function styleBlockHasRules(html: string, openEnd: number): boolean {
  // Style is raw text: the first close ends the block and anything
  // inside (even `<img>`-shaped text) is CSS, not markup. An empty
  // or comment-only block cannot hide anything and stays inert.
  const rest = html.slice(openEnd);
  const close = rest.search(STYLE_CLOSE_PATTERN);
  const body = (close === -1 ? rest : rest.slice(0, close)).replace(
    CSS_COMMENT_PATTERN,
    ''
  );
  return body.trim() !== '';
}

/**
 * Whether markup depends on a stylesheet the importer cannot
 * evaluate. Sanitization strips style blocks while keeping the
 * paragraphs they hide, silently exposing draft notes; linked
 * stylesheets are unrepresentable for the same reason. Runs
 * pre-sanitize on rendered markup (fenced code samples arrive
 * escaped), since sanitization itself removes the evidence. Comments
 * strip first: a style opener inside comment text is not markup.
 */
export function hasUnpreservableStylesheet(html: string): boolean {
  const withoutComments = stripHtmlComments(html);
  for (const match of withoutComments.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    const tagName = match[2].toLowerCase();
    if (tagName === 'style') {
      const openEnd = (match.index ?? 0) + match[0].length;
      if (styleBlockHasRules(withoutComments, openEnd)) return true;
      continue;
    }
    if (tagName !== 'link') continue;
    for (const { name, value } of tagAttributes(match[0])) {
      if (
        name === 'rel' &&
        value.toLowerCase().split(/\s+/).includes('stylesheet')
      ) {
        return true;
      }
    }
  }
  return false;
}
