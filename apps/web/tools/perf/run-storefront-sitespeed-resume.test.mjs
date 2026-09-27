import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('clears a stale stop reason and persists the resumed manifest before completion checks', () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'run-storefront-sitespeed.mjs'
    ),
    'utf8'
  );
  const clear = source.indexOf('delete manifest.stopReason');
  const persist = source.indexOf(
    'saveManifest(manifestFile, manifest);',
    clear
  );
  const loop = source.indexOf('for (const run of planned)', persist);
  expect(clear).toBeGreaterThan(-1);
  expect(persist).toBeGreaterThan(clear);
  expect(loop).toBeGreaterThan(persist);
});
