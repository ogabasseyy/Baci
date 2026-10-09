import { parseHandoffDom } from './review-handoff-dom';

// Replaced-media elements neither the sanitizer allowlist nor the
// editor nodes represent: sanitization discards the embed (iframe
// content included) while the surrounding body text lets the import
// succeed, silently dropping the video. Reject before that lossy
// step.
const UNPRESERVABLE_EMBED_SELECTOR = 'audio,embed,iframe,object,video';

/**
 * Whether markup carries an embed the editor cannot preserve. Runs
 * pre-sanitize, since sanitization itself removes the evidence.
 */
export function hasUnpreservableEmbed(html: string): boolean {
  return (
    parseHandoffDom(html).querySelector(UNPRESERVABLE_EMBED_SELECTOR) !== null
  );
}
