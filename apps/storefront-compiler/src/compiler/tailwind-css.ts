import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';
import { compile } from 'tailwindcss';
import {
  WORKER_COMPILER_LIMITS,
  type WorkerStorefrontManifest,
} from '../schemas/worker-manifest';
import { StorefrontCompilerError } from './closed-graph-plugin';

const requireFromHere = createRequire(import.meta.url);
const tailwindPkgDir = path.dirname(
  requireFromHere.resolve('tailwindcss/package.json')
);

const ALLOWED_TAILWIND_STYLESHEETS: Readonly<Record<string, string>> = {
  tailwindcss: 'index.css',
  'tailwindcss/index.css': 'index.css',
  'tailwindcss/index': 'index.css',
  'tailwindcss/theme.css': 'theme.css',
  'tailwindcss/theme': 'theme.css',
  'tailwindcss/preflight.css': 'preflight.css',
  'tailwindcss/preflight': 'preflight.css',
  'tailwindcss/utilities.css': 'utilities.css',
  'tailwindcss/utilities': 'utilities.css',
  './theme.css': 'theme.css',
  './preflight.css': 'preflight.css',
  './utilities.css': 'utilities.css',
};

const cachedTailwindFiles = new Map<string, string>();

function readPinnedTailwindCss(fileName: string): string {
  const existing = cachedTailwindFiles.get(fileName);
  if (existing !== undefined) return existing;
  const content = readFileSync(path.join(tailwindPkgDir, fileName), 'utf8');
  cachedTailwindFiles.set(fileName, content);
  return content;
}

const CANDIDATE_TOKEN_RE = /[A-Za-z0-9_:/\-[\].%!#(),+*&=$^~]+/g;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const EXTERNAL_CSS_IMPORT_RE =
  /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:|\/\/|data:|file:)/i;
const FORBIDDEN_TAILWIND_DIRECTIVE_RE = /@(?:plugin|config|source)\b/i;

function assertAllowedAssetUrl(
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

export function extractTailwindCandidates(
  manifest: WorkerStorefrontManifest
): string[] {
  const declaredAssets = new Set(manifest.assets.map((asset) => asset.assetId));
  const candidates = new Set<string>();
  for (const file of manifest.files) {
    if (file.path.endsWith('.css')) continue;
    for (const match of file.content.matchAll(CANDIDATE_TOKEN_RE)) {
      const token = match[0];
      if (!token || token.length > 120) continue;
      for (const urlMatch of token.matchAll(CSS_URL_RE)) {
        assertAllowedAssetUrl(urlMatch[2] ?? '', file.path, declaredAssets);
      }
      candidates.add(token);
    }
  }
  return Array.from(candidates);
}

function validateMerchantCssSafety(
  cssContent: string,
  filePath: string,
  declaredAssetIds: ReadonlySet<string>
): void {
  if (EXTERNAL_CSS_IMPORT_RE.test(cssContent)) {
    throw new Error(`External @import URL forbidden in "${filePath}"`);
  }
  if (FORBIDDEN_TAILWIND_DIRECTIVE_RE.test(cssContent)) {
    throw new Error(
      `Forbidden @plugin/@config/@source directive in "${filePath}"`
    );
  }
  for (const match of cssContent.matchAll(CSS_URL_RE)) {
    assertAllowedAssetUrl(match[2] ?? '', filePath, declaredAssetIds);
  }
}

export interface CompiledStorefrontCss {
  css: string;
  rawBytes: number;
  gzipBytes: number;
}

export async function compileStorefrontTailwindCss(
  manifest: WorkerStorefrontManifest
): Promise<CompiledStorefrontCss> {
  const declaredAssets = new Set(manifest.assets.map((asset) => asset.assetId));
  const virtualCssByPath = new Map<string, string>();

  for (const file of manifest.files) {
    if (!file.path.endsWith('.css')) continue;
    validateMerchantCssSafety(file.content, file.path, declaredAssets);
    virtualCssByPath.set(file.path, file.content);
  }

  // Identify virtual stylesheets already @imported by another virtual stylesheet
  // and reject cyclic @import graphs before root entry compilation.
  const importsByPath = new Map<string, string[]>();
  const childImportedPaths = new Set<string>();
  const localImportRe = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/g;
  for (const [cssPath, content] of virtualCssByPath.entries()) {
    const dir = path.posix.dirname(`/virtual/${cssPath}`);
    const deps: string[] = [];
    for (const match of content.matchAll(localImportRe)) {
      const target = match[1] ?? '';
      if (!target || ALLOWED_TAILWIND_STYLESHEETS[target]) continue;
      const resolved = path.posix.normalize(path.posix.join(dir, target));
      if (resolved.startsWith('/virtual/')) {
        const relativeDep = resolved.slice('/virtual/'.length);
        childImportedPaths.add(relativeDep);
        if (virtualCssByPath.has(relativeDep)) deps.push(relativeDep);
      }
    }
    importsByPath.set(cssPath, deps);
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const detectCssCycle = (node: string, stack: string[]): void => {
    visitState.set(node, 'visiting');
    stack.push(node);
    for (const dep of importsByPath.get(node) ?? []) {
      const state = visitState.get(dep);
      if (state === 'visiting') {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep].join(' -> ');
        throw new StorefrontCompilerError(
          'INVALID_MANIFEST',
          `Cyclic CSS @import detected: ${cycle}`
        );
      }
      if (!state) detectCssCycle(dep, stack);
    }
    stack.pop();
    visitState.set(node, 'visited');
  };
  for (const cssPath of virtualCssByPath.keys()) {
    if (!visitState.has(cssPath)) detectCssCycle(cssPath, []);
  }

  const virtualImports = Array.from(virtualCssByPath.keys())
    .filter((cssPath) => !childImportedPaths.has(cssPath))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((cssPath) => `@import "./${cssPath}";`)
    .join('\n');
  const rootCss = `@import "tailwindcss";\n${virtualImports}`;

  const compiler = await compile(rootCss, {
    base: '/virtual',
    loadModule: (id) =>
      Promise.reject(
        new Error(
          `External Tailwind module "${id}" is forbidden inside the compiler sandbox`
        )
      ),
    loadStylesheet: (id, base) => {
      const mappedTailwind = ALLOWED_TAILWIND_STYLESHEETS[id];
      if (mappedTailwind && (base === '/virtual' || base === '/tailwindcss')) {
        return Promise.resolve({
          path: `/tailwindcss/${mappedTailwind}`,
          base: '/tailwindcss',
          content: readPinnedTailwindCss(mappedTailwind),
        });
      }
      if (id.startsWith('/') || id.includes(':') || id.includes('\\')) {
        return Promise.reject(
          new Error(`Disallowed stylesheet @import "${id}"`)
        );
      }
      const normalized = path.posix.normalize(path.posix.join(base, id));
      if (!normalized.startsWith('/virtual/')) {
        return Promise.reject(
          new Error(`Stylesheet @import escapes virtual root: "${id}"`)
        );
      }
      const relativeKey = normalized.slice('/virtual/'.length);
      const virtualCss = virtualCssByPath.get(relativeKey);
      if (virtualCss !== undefined) {
        return Promise.resolve({
          path: normalized,
          base: path.posix.dirname(normalized),
          content: virtualCss,
        });
      }
      return Promise.reject(new Error(`Disallowed stylesheet @import "${id}"`));
    },
  });

  const candidates = extractTailwindCandidates(manifest);
  const rawBuiltCss = compiler.build(candidates);
  const minified = await transform(rawBuiltCss, {
    loader: 'css',
    minify: true,
  });

  const css = minified.code;
  const rawBytes = Buffer.byteLength(css, 'utf8');
  if (rawBytes > WORKER_COMPILER_LIMITS.maxCssRawBytes) {
    throw new Error(
      `Compiled CSS (${rawBytes} bytes) exceeds 256 KiB raw budget`
    );
  }
  const gzipBytes = gzipSync(Buffer.from(css, 'utf8')).byteLength;
  if (gzipBytes > WORKER_COMPILER_LIMITS.maxCssGzipBytes) {
    throw new Error(
      `Compiled CSS (${gzipBytes} gzipped bytes) exceeds 50 KiB budget`
    );
  }

  return { css, rawBytes, gzipBytes };
}
