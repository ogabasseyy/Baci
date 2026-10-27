import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The storefront cart provider wraps every storefront page, so every module it
 * statically imports ships in each page's initial `<head>` JavaScript. That JS
 * lands on Lighthouse's simulated-LCP critical path (every script that loads
 * before first paint is charged to LCP). Heavy, on-demand-only dependencies
 * must stay behind `await import()`.
 *
 * Scope: local + @baci/shared traversal only; package internals unwalked.
 */
const SRC = path.resolve(process.cwd(), 'src');
const ENTRY = path.join(SRC, 'hooks/cart/storefront-cart-provider.tsx');
const FORBIDDEN_PACKAGES = [/^@supabase\//, /^zod(?:\/|$)/];
const FORBIDDEN_MODULES = ['env.ts', 'lib/supabase/client.ts'].map((file) =>
  path.join(SRC, file)
);
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function getSharedRoot(): string {
  const c1 = path.resolve(SRC, '../../../packages/shared');
  return existsSync(c1) ? c1 : path.resolve(SRC, '../../packages/shared');
}

const SHARED_ROOT = getSharedRoot();
const SHARED_PKG_PATH = path.join(SHARED_ROOT, 'package.json');
const SHARED_PKG = JSON.parse(readFileSync(SHARED_PKG_PATH, 'utf8'));

function isForbiddenPackageSpecifier(specifier: string): boolean {
  return FORBIDDEN_PACKAGES.some((pattern) => pattern.test(specifier));
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier === '@baci/shared') {
    base = path.resolve(
      SHARED_ROOT,
      SHARED_PKG.exports?.['.'] ?? './src/index.ts'
    );
  } else if (specifier.startsWith('@baci/shared/')) {
    const sub = `.${specifier.slice('@baci/shared'.length)}`;
    base = path.resolve(
      SHARED_ROOT,
      SHARED_PKG.exports?.[sub] ?? path.join('./src', specifier.slice(13))
    );
  } else if (specifier.startsWith('@/')) {
    base = path.join(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  // moduleResolution:'bundler' maps './foo.js' to foo.ts/foo.tsx sources.
  const bases = [base.replace(/\.jsx?$/, '')];
  if (bases[0] === base) bases.push(base);
  for (const candidate of bases) {
    for (const ext of EXTENSIONS) {
      try {
        if (statSync(candidate + ext).isFile()) return candidate + ext;
      } catch {}
    }
  }
  return null;
}

function isPureBarrel(file: string): boolean {
  if (!file.startsWith(SHARED_ROOT) || SHARED_PKG.sideEffects !== false)
    return false;
  return (
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(
        /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*['"][^'"]+['"]\s*;?/gm,
        ''
      )
      .replace(/^\s*export\s+(?:type|interface)\s+[\s\S]*?(?:;|\})/gm, '')
      .trim() === ''
  );
}

function parseExports(file: string) {
  const source = readFileSync(file, 'utf8');
  const named = new Map<string, { specifier: string; originName: string }>();
  for (const match of source.matchAll(
    /^\s*export\s+\{([^}]+)\}\s+from\s*['"]([^'"]+)['"]/gm
  )) {
    for (const part of match[1].split(',')) {
      const t = part.trim();
      if (!t || /^type\s/.test(t)) continue;
      const [orig, exp] = t.split(/\s+as\s+/).map((s) => s.trim());
      named.set(exp ?? orig, { specifier: match[2], originName: orig });
    }
  }
  const stars = Array.from(
    source.matchAll(/^\s*export\s+\*\s+from\s*['"]([^'"]+)['"]/gm),
    (m) => m[1]
  );
  return { named, stars };
}

function moduleExportsSymbol(file: string, symbol: string): boolean {
  const source = readFileSync(file, 'utf8');
  return (
    new RegExp(
      `^\\s*export\\s+(?:declare\\s+)?(?:const|function\\*?|class|let|var|enum)\\s+${symbol}\\b`,
      'm'
    ).test(source) ||
    new RegExp(`^\\s*export\\s*\\{[^}]*\\b(?:as\\s+)?${symbol}\\b`, 'm').test(
      source
    )
  );
}

function resolveSymbolThroughBarrel(
  barrel: string,
  sym: string,
  visited = new Set<string>()
): string | null {
  if (visited.has(barrel)) return null;
  visited.add(barrel);
  const { named, stars } = parseExports(barrel);
  if (named.has(sym)) {
    const item = named.get(sym);
    if (!item) return null;
    const target = resolveLocal(barrel, item.specifier);
    if (!target) return null;
    return isPureBarrel(target)
      ? resolveSymbolThroughBarrel(target, item.originName, visited)
      : target;
  }
  for (const star of stars) {
    const target = resolveLocal(barrel, star);
    if (!target) continue;
    if (isPureBarrel(target)) {
      const res = resolveSymbolThroughBarrel(target, sym, visited);
      if (res) return res;
    } else if (moduleExportsSymbol(target, sym)) {
      return target;
    }
  }
  return null;
}

function staticImports(file: string) {
  const source = readFileSync(file, 'utf8');
  const imports: Array<{
    specifier: string;
    isAll: boolean;
    symbols: string[];
  }> = [];
  const pattern =
    /^\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (match[4]) {
      imports.push({ specifier: match[4], isAll: true, symbols: [] });
    } else if (!match[1]) {
      const clause = match[2].trim();
      if (/^\*\s+as\s+/.test(clause)) {
        imports.push({ specifier: match[3], isAll: true, symbols: [] });
      } else if (/^\{[^}]*\}$/.test(clause)) {
        const symbols = clause
          .slice(1, -1)
          .split(',')
          .map((p) => p.trim())
          .filter((t) => t && !/^type\s/.test(t))
          .map((t) => t.split(/\s+as\s+/)[0].trim());
        if (symbols.length > 0)
          imports.push({ specifier: match[3], isAll: false, symbols });
      } else {
        imports.push({ specifier: match[3], isAll: true, symbols: [] });
      }
    }
  }
  return imports;
}

function findForbiddenChains(entry: string): string[] {
  const violations: string[] = [];
  const visited = new Set<string>();
  const queue: string[][] = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift();
    if (!chain) break;
    const file = chain[chain.length - 1];
    if (visited.has(file)) continue;
    visited.add(file);
    for (const imp of staticImports(file)) {
      const label = chain.map((f) => path.relative(SRC, f)).join(' -> ');
      if (isForbiddenPackageSpecifier(imp.specifier)) {
        violations.push(`${label} -> ${imp.specifier}`);
        continue;
      }
      const resolved = resolveLocal(file, imp.specifier);
      if (!resolved) continue;
      if (FORBIDDEN_MODULES.includes(resolved)) {
        violations.push(`${label} -> ${path.relative(SRC, resolved)}`);
        continue;
      }
      if (isPureBarrel(resolved) && !imp.isAll) {
        for (const sym of imp.symbols) {
          const backing = resolveSymbolThroughBarrel(resolved, sym);
          queue.push(
            backing ? [...chain, resolved, backing] : [...chain, resolved]
          );
        }
      } else {
        queue.push([...chain, resolved]);
      }
    }
  }
  return violations;
}

describe('storefront cart provider static import graph', () => {
  it('keeps supabase-js, the browser Supabase client, @/env, and zod behind dynamic imports', () => {
    expect(findForbiddenChains(ENTRY)).toEqual([]);
  });

  it('keeps the related-blog browser database client out of the PDP static graph', () => {
    const file = path.join(
      SRC,
      'components/storefront/ogabassey/components/BlogSnippet.tsx'
    );
    expect(findForbiddenChains(file)).toEqual([]);
  });
});

/**
 * Client providers/chrome mounted on every storefront page. Anything they
 * statically import ships in every page's initial `<head>` JS.
 */
const ALWAYS_MOUNTED_STOREFRONT_CLIENT_ENTRIES = [
  'components/analytics/analytics-provider.tsx',
  'components/analytics/analytics-pixel-provider.tsx',
  'components/analytics/twitter-pixel.tsx',
  'hooks/merchant/storefront-merchant-provider.tsx',
  'components/storefront/storefront-theme-provider.tsx',
  'components/storefront/ogabassey/storefront-layout-providers.tsx',
  'components/storefront/ogabassey/storefront-layout-chrome.tsx',
  'app/(storefront)/[slug]/storefront-wrapper.tsx',
];

describe('always-mounted storefront client static import graph', () => {
  it.each(
    ALWAYS_MOUNTED_STOREFRONT_CLIENT_ENTRIES
  )('%s keeps zod, supabase, and @/env out of its static graph', (entry) => {
    expect(findForbiddenChains(path.join(SRC, entry))).toEqual([]);
  });
});

const FIRST_PAINT_STOREFRONT_CLIENT_ENTRIES = [
  'components/storefront/ad-attribution-capture.tsx',
  'components/storefront/cookie-consent.tsx',
  'components/storefront/ogabassey/pages/home.tsx',
  'components/storefront/ogabassey/pages/product-details.tsx',
  'components/storefront/ogabassey/pages/category-page.tsx',
  'components/storefront/ogabassey/components/ProductCard.tsx',
  'components/storefront/ogabassey/providers/v2-comparison-context.tsx',
  'components/storefront/ogabassey/providers/v2-comparison-scope.tsx',
  'app/(storefront)/[slug]/(catalog)/(listing)/search/search-compare-button.tsx',
  'app/(storefront)/[slug]/(catalog)/(listing)/search/search-comparison.tsx',
  'app/(storefront)/[slug]/(catalog)/(listing)/search/search-page-form.tsx',
  'components/storefront/search-refinements/assisted-search-suggestions.tsx',
];

describe('first-paint storefront client static import graph', () => {
  it.each(
    FIRST_PAINT_STOREFRONT_CLIENT_ENTRIES
  )('%s keeps zod, supabase, and @/env out of its static graph', (entry) => {
    expect(findForbiddenChains(path.join(SRC, entry))).toEqual([]);
  });
});

describe('forbidden package and barrel-mediated zod detection', () => {
  it('verifies packages/shared declares sideEffects: false', () => {
    expect(SHARED_PKG.sideEffects).toBe(false);
  });

  it('catches zod subpath specifiers and barrel-mediated zod chains', () => {
    expect(isForbiddenPackageSpecifier('zod')).toBe(true);
    expect(isForbiddenPackageSpecifier('zod/v4')).toBe(true);
    expect(isForbiddenPackageSpecifier('zod/mini')).toBe(true);
    expect(isForbiddenPackageSpecifier('zod-to-json-schema')).toBe(false);

    const chains = findForbiddenChains(
      path.join(SRC, 'schemas/search-assistance.ts')
    );
    expect(chains.some((c) => c.endsWith(' -> zod'))).toBe(true);
    expect(
      chains.some(
        (c) =>
          c.includes(
            'packages/shared/src/lib/search-assistance-query-schema.ts'
          ) && c.endsWith(' -> zod')
      )
    ).toBe(true);
  });
});
