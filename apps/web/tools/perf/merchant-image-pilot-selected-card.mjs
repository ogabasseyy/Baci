// Selected-card subtree extraction for the merchant image pilot preflight.
//
// The lab wraps the mounted store card in div[data-pilot-lab-selected-card],
// and only that subtree may satisfy the binding — a later filler serving the
// staged original must not cover for a broken selected card (review-3 false
// positive). Balanced-div scan (React serializes divs as open/close pairs,
// never self-closing). Returns null when the wrapper is absent or
// unterminated.
export function selectedCardSubtree(sectionHtml) {
  const html = String(sectionHtml);
  const start = /<div\b[^>]*data-pilot-lab-selected-card="true"[^>]*>/.exec(
    html
  );
  if (!start) {
    return null;
  }
  const contentStart = start.index + start[0].length;
  let depth = 1;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = contentStart;
  let tag = tags.exec(html);
  while (tag !== null) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      return html.slice(contentStart, tag.index);
    }
    tag = tags.exec(html);
  }
  return null;
}
