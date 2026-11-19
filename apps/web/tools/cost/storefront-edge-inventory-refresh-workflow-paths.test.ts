import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS } from './storefront-edge-inventory-routing-input-paths';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflow = readFileSync(
  join(repoRoot, '.github/workflows/storefront-edge-inventory-refresh.yml'),
  'utf8'
);

/** The `on.push.paths` globs, all of the form `<dir>/**` or an exact file. */
function pushPathFilters() {
  const block = workflow.match(
    /^ {2}push:\n(?: {4}.*\n)*? {4}paths:\n((?: {6}(?:- .*|#.*)\n)+)/m
  );
  if (!block) throw new Error('push paths filter not found');
  return [...block[1].matchAll(/^ {6}- '([^']+)'$/gm)].map((match) => match[1]);
}

function isCovered(path: string, filters: readonly string[]) {
  return filters.some((filter) =>
    filter.endsWith('/**')
      ? path.startsWith(filter.slice(0, -2))
      : path === filter
  );
}

describe('storefront edge inventory refresh workflow paths', () => {
  it('triggers on a change to any inventory routing input or route root', () => {
    const filters = pushPathFilters();
    const inputs = [
      ...STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS,
      'apps/web/src/app/api/route.ts',
      'apps/web/src/app/(storefront)/[slug]/page.tsx',
      'apps/web/src/app/(storefront)/ogabassey/page.tsx',
    ];

    expect(inputs.filter((path) => !isCovered(path, filters))).toEqual([]);
  });

  it('would flag a routing input outside the filter', () => {
    expect(isCovered('supabase/functions/x.ts', pushPathFilters())).toBe(false);
  });
});
