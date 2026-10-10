// Like the HTML tokenizer: `<!-->` and `<!--->` close an empty comment
// abruptly, and an opener without a closer runs through the end of
// input. Alternatives are ordered so the abrupt closers win over the
// lazy span.
const HTML_COMMENT_PATTERN = /<!--(?:>|->|-->|[\s\S]*?(?:-->|$))/g;

/**
 * Remove HTML comments: commented-out markup is editorial, never rendered,
 * so lexical tag checks must not see tags (or text) hidden inside comments.
 */
export function stripHtmlComments(value: string): string {
  return value.replace(HTML_COMMENT_PATTERN, '');
}
