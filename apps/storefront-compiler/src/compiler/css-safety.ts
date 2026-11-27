import path from 'node:path';

export const CANDIDATE_TOKEN_RE =
  /(?:[A-Za-z0-9_:/\-.%!#()+*&=$^~]|\[(?:[^[\]\s]|\[[^[\]\s]{0,80}\]){1,100}\])+/g;
export const CSS_URL_RE =
  /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^'")\s]+))\s*\)/gi;

const EXTERNAL_CSS_IMPORT_RE =
  /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:|\/\/|data:|file:)/i;
const FORBIDDEN_TAILWIND_DIRECTIVE_RE = /@(?:plugin|config|source)\b/i;
const IMPORT_URL_CALL_RE =
  /@import\s+url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^'")\s]+))\s*\)/gi;

export function extractMatchedCssUrl(match: RegExpExecArray): string {
  return match[1] ?? match[2] ?? match[3] ?? '';
}

export function assertAllowedAssetUrl(
  rawUrl: string,
  sourceLabel: string,
  declaredAssetIds: ReadonlySet<string>
): void {
  const trimmed = rawUrl.trim();
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

export function decodeCssEscapes(rawCss: string): string {
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

export function validateAndNormalizeMerchantCss(
  cssContent: string,
  filePath: string,
  declaredAssetIds: ReadonlySet<string>,
  virtualCssPaths: ReadonlySet<string>
): string {
  const dir = path.posix.dirname(`/virtual/${filePath}`);
  const unescaped = decodeCssEscapes(cssContent);

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

  for (const candidate of [cssContent, unescaped]) {
    if (EXTERNAL_CSS_IMPORT_RE.test(candidate)) {
      throw new Error(`External @import URL forbidden in "${filePath}"`);
    }
    if (FORBIDDEN_TAILWIND_DIRECTIVE_RE.test(candidate)) {
      throw new Error(
        `Forbidden @plugin/@config/@source directive in "${filePath}"`
      );
    }
    const stripped = normalizeImportUrls(candidate, true);
    for (const match of stripped.matchAll(CSS_URL_RE)) {
      assertAllowedAssetUrl(
        extractMatchedCssUrl(match),
        filePath,
        declaredAssetIds
      );
    }
  }

  return normalizeImportUrls(cssContent, false);
}
