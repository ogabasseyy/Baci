import { parseHandoffDom } from './review-handoff-dom';

const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

function styleBlockHasRules(style: HTMLStyleElement): boolean {
  // Style is raw text, so the parsed textContent is the whole block
  // even when it holds `<img>`-shaped text. An empty or comment-only
  // block cannot hide anything and stays inert.
  const body = (style.textContent ?? '').replace(CSS_COMMENT_PATTERN, '');
  return body.trim() !== '';
}

/**
 * Whether markup depends on a stylesheet the importer cannot
 * evaluate. Sanitization strips style blocks while keeping the
 * paragraphs they hide, silently exposing draft notes; linked
 * stylesheets are unrepresentable for the same reason. Runs
 * pre-sanitize on rendered markup (fenced code samples arrive
 * escaped), since sanitization itself removes the evidence.
 */
export function hasUnpreservableStylesheet(html: string): boolean {
  const doc = parseHandoffDom(html);
  for (const style of doc.querySelectorAll('style')) {
    if (styleBlockHasRules(style)) return true;
  }
  for (const link of doc.querySelectorAll('link')) {
    const rel = link.getAttribute('rel');
    if (rel?.toLowerCase().split(/\s+/).includes('stylesheet')) {
      return true;
    }
  }
  return false;
}
