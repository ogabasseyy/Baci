import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { staticGraph } from './graph.mjs';

test('captures type-only imports and external edges in the full static graph', async () => {
  const root = await mkdtemp('/private/tmp/provider-graph-test-');
  try {
    await mkdir(path.join(root, 'apps/web/src'), { recursive: true });
    await writeFile(
      path.join(root, 'apps/web/src/entry.ts'),
      'import type { Value } from "./value"; import fs from "node:fs"; export const value: Value = {};'
    );
    await writeFile(
      path.join(root, 'apps/web/src/value.ts'),
      'export type Value = {};'
    );
    const graph = await staticGraph(root, { sample: 'apps/web/src/entry.ts' });
    assert.equal(Object.keys(graph.sources).length, 2);
    assert.equal(
      graph.imports['apps/web/src/entry.ts'][0].target,
      'apps/web/src/value.ts'
    );
    assert.equal(graph.imports['apps/web/src/entry.ts'][1].external, true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('refuses unresolved local imports instead of claiming a complete graph', async () => {
  const root = await mkdtemp('/private/tmp/provider-graph-test-');
  try {
    await mkdir(path.join(root, 'apps/web/src'), { recursive: true });
    await writeFile(
      path.join(root, 'apps/web/src/entry.ts'),
      'import "./missing";'
    );
    await assert.rejects(
      staticGraph(root, { sample: 'apps/web/src/entry.ts' }),
      /Unresolved local/
    );
    await assert.rejects(
      staticGraph(root, { sample: '../outside.ts' }),
      /outside bounded/
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
