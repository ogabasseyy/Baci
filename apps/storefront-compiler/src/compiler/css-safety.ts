import path from 'node:path';

const CSS_URL_RE =
  /url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;
const CSS_SRC_FN_RE =
  /\bsrc\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;
const IMAGE_SET_START_RE = /(?:-[a-z]+-)?image-set\s*\(/gi;
const IMAGE_SET_TOKEN_RE =
  /\b(?:url|type)\s*\(\s*(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^'")\s]*)\s*\)|"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/gi;
const EXTERNAL_CSS_IMPORT_RE =
  /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:|\/\/|data:|file:)/i;
const FORBIDDEN_TAILWIND_DIRECTIVE_RE = /@(?:plugin|config|source)\b/i;
const IMPORT_URL_CALL_RE =
  /@import\s+url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;

function stripCssComments(rawCss: string): string {
  return rawCss.replace(
    /(\\([\s\S])|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')|\/\*[\s\S]*?(?:\*\/|$)/g,
    (_match, kept: string | undefined) => (kept !== undefined ? kept : '/**/')
  );
}

function decodeCssEscapes(rawCss: string): string {
  return rawCss.replace(
    /\\([0-9a-fA-F]{1,6})\s?|\\(.)/g,
    (_match, hex: string | undefined, ch: string | undefined) => {
      if (hex !== undefined) {
        const codePoint = Number.parseInt(hex, 16);
        if (
          Number.isFinite(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
        ) {
          return String.fromCodePoint(codePoint);
        }
      }
      return ch ?? '';
    }
  );
}

export function normalizeCssForInspection(rawCss: string): {
  withoutComments: string;
  unescaped: string;
} {
  const withoutComments = stripCssComments(rawCss);
  return {
    withoutComments,
    unescaped: decodeCssEscapes(withoutComments),
  };
}

export function extractAllCssResourceUrls(cssText: string): string[] {
  const urls: string[] = [];
  for (const m of cssText.matchAll(CSS_URL_RE)) {
    urls.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of cssText.matchAll(CSS_SRC_FN_RE)) {
    urls.push(m[1] ?? m[2] ?? m[3] ?? '');
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

export function assertAllowedAssetUrl(
  rawUrl: string,
  sourceLabel: string,
  declaredAssetIds: ReadonlySet<string>
): void {
  const trimmed = decodeCssEscapes(rawUrl).trim();
  if (trimmed.startsWith('#')) return;
  if (trimmed.startsWith('/assets/')) {
    const assetId = trimmed.slice('/assets/'.length);
    if (!declaredAssetIds.has(assetId)) {
      throw new Error(`Undeclared asset URL "${trimmed}" in "${sourceLabel}"`);
    }
    return;
  }
  throw new Error(
    `Disallowed CSS url("${trimmed}") in "${sourceLabel}"; declare media in manifest.assets`
  );
}

export function validateAndNormalizeMerchantCss(
  cssContent: string,
  filePath: string,
  declaredAssetIds: ReadonlySet<string>,
  virtualCssPaths: ReadonlySet<string>
): string {
  const dir = path.posix.dirname(`/virtual/${filePath}`);
  const { withoutComments, unescaped } = normalizeCssForInspection(cssContent);

  const normalizeImportUrls = (input: string, placeholderOnly: boolean) =>
    input.replace(
      IMPORT_URL_CALL_RE,
      (
        full,
        dq: string | undefined,
        sq: string | undefined,
        u: string | undefined
      ) => {
        const raw = (dq ?? sq ?? u ?? '').trim();
        if (
          !raw ||
          raw.startsWith('/') ||
          raw.includes(':') ||
          raw.includes('\\')
        ) {
          return full;
        }
        const resolved = path.posix.normalize(path.posix.join(dir, raw));
        if (
          resolved.startsWith('/virtual/') &&
          virtualCssPaths.has(resolved.slice('/virtual/'.length))
        ) {
          return placeholderOnly
            ? '@import ""'
            : `@import ${JSON.stringify(raw)}`;
        }
        return full;
      }
    );

  for (const candidate of [withoutComments, unescaped]) {
    if (EXTERNAL_CSS_IMPORT_RE.test(candidate)) {
      throw new Error(`External @import URL forbidden in "${filePath}"`);
    }
    if (FORBIDDEN_TAILWIND_DIRECTIVE_RE.test(candidate)) {
      throw new Error(
        `Forbidden @plugin/@config/@source directive in "${filePath}"`
      );
    }
    const stripped = normalizeImportUrls(candidate, true);
    for (const rawUrl of extractAllCssResourceUrls(stripped)) {
      assertAllowedAssetUrl(rawUrl, filePath, declaredAssetIds);
    }
  }

  return normalizeImportUrls(withoutComments, false);
}
