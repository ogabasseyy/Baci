import { parseHandoffDom } from './review-handoff-dom';

// Replaced-media elements neither the sanitizer allowlist nor the
// editor nodes represent: sanitization discards the embed (iframe
// content included) while the surrounding body text lets the import
// succeed, silently dropping the video. Canvas joins the set for the
// opposite loss: its fallback content renders only where canvas is
// unsupported, but sanitization unwraps the disallowed element and
// keeps the child, publishing hidden fallback as visible text.
// Reject before that lossy step.
const UNPRESERVABLE_EMBED_SELECTOR = 'audio,canvas,embed,iframe,object,video';

/**
 * Whether markup carries an embed the editor cannot preserve. Runs
 * pre-sanitize, since sanitization itself removes the evidence.
 */
export function hasUnpreservableEmbed(html: string): boolean {
  return (
    parseHandoffDom(html).querySelector(UNPRESERVABLE_EMBED_SELECTOR) !== null
  );
}
