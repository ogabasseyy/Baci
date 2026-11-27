const CSS_URL_RE =
  /url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;
const CSS_SRC_FN_RE =
  /\bsrc\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;
const IMAGE_SET_START_RE = /(?:-[a-z]+-)?image-set\s*\(/gi;
const IMAGE_SET_TOKEN_RE =
  /\b(?:url|type)\s*\(\s*(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^'")\s]*)\s*\)|"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/gi;

function extractMatchedUrl(match: RegExpExecArray): string {
  return match[1] ?? match[2] ?? match[3] ?? '';
}

export function extractAllCssResourceUrls(cssText: string): string[] {
  const urls: string[] = [];
  for (const m of cssText.matchAll(CSS_URL_RE)) {
    urls.push(extractMatchedUrl(m));
  }
  for (const m of cssText.matchAll(CSS_SRC_FN_RE)) {
    urls.push(extractMatchedUrl(m));
  }
  for (const startMatch of cssText.matchAll(IMAGE_SET_START_RE)) {
    let idx = (startMatch.index ?? 0) + startMatch[0].length;
    let depth = 1;
    const bodyStart = idx;
    while (idx < cssText.length && depth > 0) {
      const ch = cssText[idx];
      if (ch === '\\') {
        idx += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        idx += 1;
        while (idx < cssText.length && cssText[idx] !== quote) {
          idx += cssText[idx] === '\\' ? 2 : 1;
        }
        idx += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      idx += 1;
    }
    const endIdx = depth === 0 ? idx - 1 : Math.min(idx, cssText.length);
    const rawBody = cssText.slice(bodyStart, Math.max(bodyStart, endIdx));
    for (const tok of rawBody.matchAll(IMAGE_SET_TOKEN_RE)) {
      const strUrl = tok[1] ?? tok[2];
      if (strUrl !== undefined) urls.push(strUrl);
    }
  }
  return urls;
}
