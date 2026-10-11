import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { linkSharedZod, verifySharedZod } from './verify-shared-zod.mjs';

test.each([
  {
    name: 'different peers with the same Zod 4 API',
    local: true,
    rootApi: true,
    webApi: true,
    link: false,
    valid: false,
  },
  {
    name: 'same peer without the Zod 4 API',
    local: false,
    rootApi: false,
    webApi: false,
    link: false,
    valid: false,
  },
  {
    name: 'production Zod 3 fallback',
    local: true,
    rootApi: false,
    webApi: true,
    link: false,
    valid: false,
  },
  {
    name: 'linked web-local Zod 4',
    local: true,
    rootApi: false,
    webApi: true,
    link: true,
    valid: true,
  },
  {
    name: 'linked hoisted Zod 4',
    local: false,
    rootApi: true,
    webApi: true,
    link: true,
    valid: true,
  },
  {
    name: 'replaces a stale peer link',
    local: true, rootApi: false, webApi: true, link: true, valid: true, stale: true,
  },
])('$name', ({ local, rootApi, webApi, link, valid, stale }) => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-zod-runtime-'));
  try {
    const web = join(root, 'apps/web');
    const shared = join(root, 'packages/shared');
    const rootZod = join(root, 'node_modules/zod');
    const webZod = join(web, 'node_modules/zod');
    for (const directory of [
      web,
      shared,
      rootZod,
      ...(local ? [webZod] : []),
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    for (const directory of [web, shared])
      writeFileSync(join(directory, 'package.json'), '{}');
    for (const [directory, api] of [
      [rootZod, rootApi],
      ...(local ? [[webZod, webApi]] : []),
    ]) {
      writeFileSync(join(directory, 'package.json'), '{"main":"index.js"}');
      writeFileSync(
        join(directory, 'index.js'),
        api ? 'exports.z = { uuid() {} };' : 'exports.z = {};'
      );
    }
    if (link) {
      if (stale) {
        mkdirSync(join(shared, 'node_modules'));
        symlinkSync(join(root, 'missing-zod'), join(shared, 'node_modules/zod'));
      }
      linkSharedZod(web, shared);
      linkSharedZod(web, shared);
    }
    if (valid) {
      verifySharedZod(web, shared);
    } else {
      assert.throws(
        () => verifySharedZod(web, shared),
        /Zod 4 peer dependency/
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing Zod retains the clear peer error and its module-resolution cause', () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-zod-missing-'));
  try {
    assert.throws(() => verifySharedZod(root, root), (error) => {
      assert.match(error.message, /Zod 4 peer dependency/);
      assert.equal(error.cause.code, 'MODULE_NOT_FOUND');
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
