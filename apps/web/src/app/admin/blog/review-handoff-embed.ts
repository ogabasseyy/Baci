import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { stripHtmlComments } from './strip-html-comments';

// Replaced-media elements neither the sanitizer allowlist nor the
// editor nodes represent: sanitization discards the embed (iframe
// content included) while the surrounding body text lets the import
// succeed, silently dropping the video. Reject before that lossy
// step. Comments strip first: an embed opener inside comment text is
// not markup.
const UNPRESERVABLE_EMBED_TAGS = new Set([
  'audio',
  'embed',
  'iframe',
  'object',
  'video',
]);

/**
 * Whether markup carries an embed the editor cannot preserve. Runs
 * pre-sanitize, since sanitization itself removes the evidence.
 */
export function hasUnpreservableEmbed(html: string): boolean {
  for (const match of stripHtmlComments(html).matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (UNPRESERVABLE_EMBED_TAGS.has(match[2].toLowerCase())) return true;
  }
  return false;
}
