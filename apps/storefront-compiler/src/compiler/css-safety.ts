import path from 'node:path';
import { assertAllowedAssetUrl } from './css-asset-policy';
import { extractAllCssResourceUrls } from './css-resource-urls';
import { normalizeCssForInspection } from './css-text-normalize';

const EXTERNAL_CSS_IMPORT_RE =
  /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:|\/\/|data:|file:)/i;
const FORBIDDEN_TAILWIND_DIRECTIVE_RE = /@(?:plugin|config|source)\b/i;
const IMPORT_URL_CALL_RE =
  /@import\s+url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^'")\s]+))\s*\)/gi;

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
