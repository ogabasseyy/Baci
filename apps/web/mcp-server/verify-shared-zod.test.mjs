import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifySharedZod } from './verify-shared-zod.mjs';

test('rejects the production Zod 3 fallback and accepts the web Zod 4 peer', () => {
  for (const peerLinked of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'mcp-zod-runtime-'));
    try {
      const web = join(root, 'apps/web');
      const shared = join(root, 'packages/shared');
      for (const directory of [web, shared, join(root, 'node_modules/zod'), join(web, 'node_modules/zod')]) {
        mkdirSync(directory, { recursive: true });
      }
      for (const directory of [web, shared]) writeFileSync(join(directory, 'package.json'), '{}');
      writeFileSync(join(root, 'node_modules/zod/index.js'), 'exports.z = {};');
      writeFileSync(join(web, 'node_modules/zod/index.js'), 'exports.z = { uuid() {} };');
      if (peerLinked) {
        mkdirSync(join(shared, 'node_modules'));
        symlinkSync(join(web, 'node_modules/zod'), join(shared, 'node_modules/zod'));
        verifySharedZod(web, shared);
      } else {
        assert.throws(() => verifySharedZod(web, shared), /Zod 4 peer dependency/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
