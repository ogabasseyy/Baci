import { parseHandoffDom } from './review-handoff-dom';
import { stripHtmlComments } from './strip-html-comments';

/**
 * Remove inert template subtrees before sanitization. Template
 * contents never render in the source document, but the sanitizer
 * discards only the disallowed wrapper and keeps its allowed
 * descendants — surfacing notes the author never displayed. A real
 * parser locates the template elements, so openers inside raw-text
 * elements (`<script>`, `<style>`) or attribute values never count
 * as markup. Comments strip first: a template opener inside comment
 * text is not markup, and the sanitizer drops comments anyway. A
 * stray close parses to nothing (the sanitizer would discard it),
 * and an unclosed template auto-closes at end of input per HTML.
 */
export function stripTemplateSubtrees(html: string): string {
  const doc = parseHandoffDom(stripHtmlComments(html));
  for (const template of doc.querySelectorAll('template')) {
    template.remove();
  }
  return doc.body.innerHTML;
}
