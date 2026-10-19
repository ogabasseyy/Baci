import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '../../app/pilot-lab');

// Server-entry modules must only import server-safe lab modules: calling
// an exported function from a 'use client' module throws at request time
// ("It's not possible to invoke a client function from the server"). Client
// Components may be imported (they render); plain functions may not. This
// guard fails closed on any lab import that resolves to a client module,
// forcing pure helpers into shared modules (see lab-fixtures.ts).
const SERVER_ENTRIES = [
  join(here, 'lab-store-page.tsx'),
  join(appDir, 'page.tsx'),
  join(appDir, 'store/[storeSlug]/page.tsx'),
  join(appDir, 'store/[storeSlug]/lab-category/[productSlug]/page.tsx'),
  join(appDir, 'lab-route.ts'),
];

function labImportsOf(source: string): Array<{
  names: string[];
  specifier: string;
}> {
  const found: Array<{ names: string[]; specifier: string }> = [];
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?(?:(\w+)\s*(?:,\s*)?)?(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"]/g
  )) {
    const names = (match[2] ?? '')
      .split(',')
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, '')
          .replace(/\s+as\s+\w+$/, '')
      )
      .filter((name) => name.length > 0);
    if (match[1]) {
      names.push(match[1]);
    }
    found.push({ names, specifier: match[3] });
  }
  return found;
}

function resolveLabImport(entry: string, specifier: string): string | null {
  if (specifier.startsWith('@/lib/merchant-image-variant-pilot/')) {
    const name = specifier.slice('@/lib/merchant-image-variant-pilot/'.length);
    return join(here, name);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return join(dirname(entry), specifier);
  }
  return null;
}

function withExtension(base: string): string {
  for (const extension of ['.tsx', '.ts']) {
    try {
      readFileSync(`${base}${extension}`, 'utf8');
      return `${base}${extension}`;
    } catch {
      // Try the next extension.
    }
  }
  throw new Error(`cannot resolve lab import target for ${base}`);
}

describe('pilot lab server boundary', () => {
  it('keeps server entries clear of client modules', () => {
    const violations: string[] = [];
    for (const entry of SERVER_ENTRIES) {
      const source = readFileSync(entry, 'utf8');
      for (const { names, specifier } of labImportsOf(source)) {
        const base = resolveLabImport(entry, specifier);
        if (!base) {
          continue;
        }
        const target = withExtension(base);
        const targetSource = readFileSync(target, 'utf8');
        // A real directive sits before any code; quoted mentions inside
        // comments (like this file's own prose) must not count.
        const head = targetSource.slice(0, 2000);
        if (!/(^|\n)['"]use client['"];/.test(head)) {
          continue;
        }
        // PascalCase imports are Client Components (legal to render);
        // anything else is a callable value and throws at request time.
        for (const name of names) {
          if (!/^[A-Z]/.test(name)) {
            violations.push(
              `${entry} calls ${name} from client module ${specifier}`
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('labImportsOf', () => {
  it('sees default-only imports', () => {
    // A default-only import of a client-module function must not slip past
    // the guard unmatched.
    expect(labImportsOf(`import labHelper from './lab-card-clone';\n`)).toEqual(
      [{ names: ['labHelper'], specifier: './lab-card-clone' }]
    );
  });

  it('checks the imported name, not the alias', () => {
    expect(
      labImportsOf(`import { labHelper as helper } from './lab-card-clone';\n`)
    ).toEqual([{ names: ['labHelper'], specifier: './lab-card-clone' }]);
  });
});
