import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(process.cwd(), 'src');
const ENTRY = path.join(
  SRC,
  'components/storefront/experience/experience-host-dispatcher.ts'
);
const FORBIDDEN = [
  path.join(SRC, 'hooks/cart/shared-cart-client.ts'),
  path.join(SRC, 'lib/experience/commerce-context.ts'),
  path.join(SRC, 'components/storefront/experience/experience-cart-adapter.ts'),
];
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
      // Try the next extension.
    }
  }
  return null;
}

/** Static value imports only; type-only imports and import() are skipped. */
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
      const resolved = resolveLocal(file, specifier);
      if (!resolved) continue;
      const label = chain.map((item) => path.relative(SRC, item)).join(' -> ');
      if (FORBIDDEN.includes(resolved)) {
        violations.push(`${label} -> ${path.relative(SRC, resolved)}`);
        continue;
      }
      queue.push([...chain, resolved]);
    }
  }
  return violations;
}

describe('experience host dispatcher static import graph', () => {
  it('keeps shared cart and checkout commerce dependencies behind import()', () => {
    expect(findForbiddenChains(ENTRY)).toEqual([]);
  });
});
