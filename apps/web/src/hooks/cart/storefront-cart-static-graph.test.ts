import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The storefront cart provider wraps every storefront page, so every module it
 * statically imports ships in each page's initial `<head>` JavaScript. That JS
 * lands on Lighthouse's simulated-LCP critical path (every script that loads
 * before first paint is charged to LCP). Heavy, on-demand-only dependencies
 * must stay behind `await import()`.
 */
const SRC = path.resolve(process.cwd(), 'src');
const ENTRY = path.join(SRC, 'hooks/cart/storefront-cart-provider.tsx');
const FORBIDDEN_PACKAGES = [/^@supabase\//, /^zod$/];
const FORBIDDEN_MODULES = ['env.ts', 'lib/supabase/client.ts'].map((file) =>
  path.join(SRC, file)
);
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.'))
    base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** Static value imports/re-exports only; `import type` and `import()` are skipped. */
function staticValueSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const pattern =
    /^\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (match[4]) {
      specifiers.push(match[4]);
      continue;
    }
    if (match[1]) continue;
    const clause = match[2].trim();
    const typeOnlyNamed =
      /^\{[^}]*\}$/.test(clause) &&
      clause
        .slice(1, -1)
        .split(',')
        .every((part) => !part.trim() || /^type\s/.test(part.trim()));
    if (!typeOnlyNamed) specifiers.push(match[3]);
  }
  return specifiers;
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
    for (const specifier of staticValueSpecifiers(file)) {
      const label = chain.map((f) => path.relative(SRC, f)).join(' -> ');
      if (FORBIDDEN_PACKAGES.some((pattern) => pattern.test(specifier))) {
        violations.push(`${label} -> ${specifier}`);
        continue;
      }
      const resolved = resolveLocal(file, specifier);
      if (!resolved) continue;
      if (FORBIDDEN_MODULES.includes(resolved)) {
        violations.push(`${label} -> ${path.relative(SRC, resolved)}`);
        continue;
      }
      queue.push([...chain, resolved]);
    }
  }
  return violations;
}

describe('storefront cart provider static import graph', () => {
  it('keeps supabase-js, the browser Supabase client, @/env, and zod behind dynamic imports', () => {
    expect(findForbiddenChains(ENTRY)).toEqual([]);
  });

  it('keeps the related-blog browser database client out of the PDP static graph', () => {
    expect(
      findForbiddenChains(
        path.join(
          SRC,
          'components/storefront/ogabassey/components/BlogSnippet.tsx'
        )
      )
    ).toEqual([]);
  });
});
