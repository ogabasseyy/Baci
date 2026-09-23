const TEMPLATE_PATTERN = /<template\b[^>]*>[\s\S]*?<\/template>/gi;
const HIDDEN_DIV_OPEN_PATTERN = /<div\s+hidden\b[^>]*>/i;
const NEXT_DIV_TOKEN_PATTERN = /<\/div>|<div\b/i;

function findMatchingDivClose(html: string, afterOpen: number): number {
  let depth = 1;
  let cursor = afterOpen;

  while (depth > 0 && cursor < html.length) {
    const token = NEXT_DIV_TOKEN_PATTERN.exec(html.slice(cursor));
    if (!token || token.index === undefined) {
      return html.length;
    }

    const tokenStart = cursor + token.index;
    if (token[0].toLowerCase() === '</div>') {
      depth -= 1;
      cursor = tokenStart + token[0].length;
      continue;
    }

    const tagEnd = html.indexOf('>', tokenStart);
    depth += 1;
    cursor = tagEnd === -1 ? html.length : tagEnd + 1;
  }

  return cursor;
}

export function getVisiblePrerenderHtml(html: string): string {
  let remaining = html.replace(TEMPLATE_PATTERN, '');

  while (true) {
    const open = remaining.match(HIDDEN_DIV_OPEN_PATTERN);
    if (!open || open.index === undefined) {
      return remaining;
    }

    const close = findMatchingDivClose(remaining, open.index + open[0].length);
    remaining = remaining.slice(0, open.index) + remaining.slice(close);
  }
}
