/**
 * Remove HTML comments: commented-out markup is editorial, never rendered,
 * so lexical tag checks must not see tags (or text) hidden inside comments.
 */
export function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}
