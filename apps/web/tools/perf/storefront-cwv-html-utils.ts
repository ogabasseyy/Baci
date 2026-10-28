import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import type {
  HeadJsChunkContent,
  StorefrontCwvGuardRoute,
} from './storefront-cwv-guard-budgets';

/** Extracts the inner HTML of the document `<head>` section. */
export function extractHeadSection(html: string): string {
  return html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
}

/** Sums UTF-8 byte length of inline `<script>` tags carrying Next.js RSC Flight chunks. */
export function getInlineRscBytes(html: string): number {
  let bytes = 0;
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].includes('self.__next_f.push')) {
      bytes += Buffer.byteLength(m[1], 'utf8');
    }
  }
  return bytes;
}

/** Extracts inner HTML of React Fizz `<div hidden id="S:...">` containers regardless of attribute order. */
export function extractHiddenSuspenseSections(html: string): string[] {
  const sections: string[] = [];
  for (const open of html.matchAll(/<div\b[^>]*>/gi)) {
    const tag = open[0];
    if (!/\bhidden\b/i.test(tag) || !/\bid=["']S:[^"']+["']/i.test(tag)) {
      continue;
    }
    const start = (open.index ?? 0) + tag.length;
    const divRe = /<(\/?)div\b[^>]*>/gi;
    divRe.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let m = divRe.exec(html); m && depth > 0; m = divRe.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) end = m.index;
    }
    sections.push(html.slice(start, end));
  }
  return sections;
}

/** Extracts `<link rel="preload" as="image">` tags from `<head>`. */
export function extractImagePreloadTags(headHtml: string): string[] {
  return [...headHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter(
      (t) => /\brel=["']preload["']/i.test(t) && /\bas=["']image["']/i.test(t)
    );
}

/** Reads an HTML attribute value from a single opening tag string. */
export function extractAttribute(tag: string, attrName: string): string | null {
  return (
    tag.match(
      new RegExp(`(?<![\\w:-])${attrName}=["']([^"']+)["']`, 'i')
    )?.[1] ?? null
  );
}

/** Checks whether an opening HTML tag has a boolean attribute (ignoring quoted attribute values). */
export function hasBooleanAttribute(tag: string, attrName: string): boolean {
  const withoutQuotedValues = tag.replace(/=\s*(?:"[^"]*"|'[^']*')/g, '');
  return new RegExp(`\\s${attrName}(?=[\\s=/>])`, 'i').test(
    withoutQuotedValues
  );
}

/** Returns `src` values of `<script async>` tags in the given `<head>` HTML. */
export function extractAsyncHeadScriptUrls(headHtml: string): string[] {
  return [...headHtml.matchAll(/<script\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => hasBooleanAttribute(tag, 'async'))
    .map((tag) => extractAttribute(tag, 'src'))
    .filter((src): src is string => Boolean(src));
}

/** Splits an HTML `srcset` into candidate URLs on comma+whitespace boundaries. */
export function parseSrcSetUrls(srcSet: string | null): string[] {
  if (!srcSet) return [];
  return srcSet
    .split(/,\s+/)
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((url): url is string => Boolean(url));
}

/** Validates a hero image URL against allowed origins, resolving relative URLs against baseOrigin. */
export function isAllowedHeroUrl(
  rawUrl: string,
  allowedOrigins: readonly string[],
  baseOrigin = 'https://ogabassey.com'
): boolean {
  const u = rawUrl.trim().split(/\s+/)[0] ?? '';
  if (!u || u.startsWith('data:')) return true;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(u) && !/^https?:\/\//i.test(u)) {
    return false;
  }
  try {
    const resolved = u.startsWith('http') ? new URL(u) : new URL(u, baseOrigin);
    return allowedOrigins.includes(resolved.origin);
  } catch {
    return false;
  }
}

const ROUTE_CSS_SOURCE_FILES: Readonly<
  Record<StorefrontCwvGuardRoute, readonly string[]>
> = {
  home: ['app/(storefront)/ogabassey/load-ogabassey-home-styles.ts'],
  category: ['app/(storefront)/storefront-eager-listing-css-layout.tsx'],
  brandHub: ['app/(storefront)/storefront-eager-listing-css-layout.tsx'],
  pdp: [
    'app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx',
  ],
  blogPost: ['app/(storefront)/[slug]/(blog)/blog/[postSlug]/layout.tsx'],
};

/** Counts static (side-effect, default, named, namespace) `.css` imports in TypeScript/TSX source. */
export function countCssImportsInSource(source: string): number {
  return [
    ...source.matchAll(
      /^\s*import\s+(?:[^'"]+?\s+from\s+)?['"][^'"]+\.css['"]/gm
    ),
  ].length;
}

function resolveLocalModulePath(
  specifier: string,
  importerPath: string,
  webSrcDir: string
): string | null {
  if (specifier.endsWith('.css')) return null;
  const basePath = specifier.startsWith('@/')
    ? path.join(webSrcDir, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(importerPath), specifier)
      : null;
  if (!basePath) return null;
  for (const candidate of [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** Counts `.css` imports in the storefront route entry files (and transitive static local imports) for a monitored route. */
export function countStorefrontRouteCssImports(
  route: StorefrontCwvGuardRoute,
  webSrcDir: string
): number {
  const visited = new Set<string>();
  let count = 0;
  const visitFile = (filePath: string) => {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    const source = readFileSync(filePath, 'utf8');
    count += countCssImportsInSource(source);
    for (const m of source.matchAll(
      /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/gm
    )) {
      const child = resolveLocalModulePath(m[1] ?? '', filePath, webSrcDir);
      if (child) visitFile(child);
    }
  };
  for (const relPath of ROUTE_CSS_SOURCE_FILES[route]) {
    visitFile(path.join(webSrcDir, relPath));
  }
  return count;
}

/** Builds a single route CSS guard input from real source files in `apps/web/src`. */
export function buildStorefrontCssGuardInput(
  route: StorefrontCwvGuardRoute,
  webSrcDir: string,
  criticalCss: string
): {
  brandAuthoritySource: string;
  criticalCss: string;
  listingLayoutSource: string;
  route: StorefrontCwvGuardRoute;
  stylesheetCount: number;
} {
  const needsListingLayout = route === 'category' || route === 'brandHub';
  return {
    brandAuthoritySource:
      route === 'brandHub'
        ? readFileSync(
            path.join(
              webSrcDir,
              'app/(storefront)/[slug]/(catalog)/(listing)/[category]/brands/[brandSlug]/brand-authority-page-content.tsx'
            ),
            'utf8'
          )
        : '',
    criticalCss,
    listingLayoutSource: needsListingLayout
      ? readFileSync(
          path.join(
            webSrcDir,
            'app/(storefront)/[slug]/(catalog)/(listing)/layout.tsx'
          ),
          'utf8'
        )
      : '',
    route,
    stylesheetCount: countStorefrontRouteCssImports(route, webSrcDir),
  };
}

/** Loads `<head>` async script chunk contents and brotli sizes from a `.next` build directory. */
export function loadHeadChunkContentsFromBuildDir(
  html: string,
  nextBuildDir: string
): Record<string, HeadJsChunkContent> {
  const headHtml = extractHeadSection(html);
  const scriptUrls = extractAsyncHeadScriptUrls(headHtml);

  const chunkContents: Record<string, HeadJsChunkContent> = {};
  for (const scriptUrl of [...new Set(scriptUrls)]) {
    const cleanPath = scriptUrl.split('?')[0] ?? '';
    const relFromNext = cleanPath.replace(/^\/_next\//, '');
    const diskPath = path.join(nextBuildDir, relFromNext);
    if (!existsSync(diskPath)) continue;
    const raw = readFileSync(diskPath, 'utf8');
    chunkContents[scriptUrl] = {
      brotliBytes: brotliCompressSync(Buffer.from(raw, 'utf8')).byteLength,
      raw,
    };
  }
  return chunkContents;
}
