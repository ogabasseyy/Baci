// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { STORE_WIDGET_URI } from '../mcp-server/widget-resource-uri';
import {
  CONNECTOR_MANIFEST,
  CONNECTOR_TOOL_NAMES,
} from '../src/lib/connector/manifest';

it('keeps the standalone graph free of Next, editor, database, provider and vault modules', async () => {
  const result = await build({
    entryPoints: [path.resolve('builder-mcp-server/serve.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    packages: 'external',
    metafile: true,
    tsconfig: 'tsconfig.json',
  });
  const graph = JSON.stringify(result.metafile);
  expect(graph).not.toMatch(
    /next\/|@supabase\/|builder-gateway|tools\/builder-auth|builder-ai|components\/|template-registry|\/env\.ts/
  );
});
it('preserves the separate Muse read-only contract and buyer resource registrations', () => {
  expect(CONNECTOR_TOOL_NAMES).toEqual([
    'orders.list',
    'orders.get',
    'inventory.levels',
    'analytics.summary',
  ]);
  expect(CONNECTOR_MANIFEST).toHaveLength(4);
  expect(STORE_WIDGET_URI).toBe('ui://widget/store-v5.html');
  const source = readFileSync(path.resolve('mcp-server/server.ts'), 'utf8');
  expect(source).toContain("'ui://widget/store-v4.html'");
  expect(source).toContain('uri === STORE_WIDGET_URI');
  const registry = readFileSync(
    path.resolve('builder-mcp-server/registry.ts'),
    'utf8'
  );
  expect(registry).not.toContain('registerResource');
});
