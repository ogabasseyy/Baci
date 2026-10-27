import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { assertGuidePrebuilt } from './assert-guide-prebuilt.mjs';

test('rejects missing or changed prebuilt screenshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'guide-prebuilt-'));
  try {
    const images = ['ad-platforms/meta-settings.jpg', 'chatgpt-ads/example.png'];
    for (const image of images) {
      for (const prefix of ['public/guides', '.vercel/output/static/guides']) {
        const file = join(root, prefix, image);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, 'image bytes');
      }
    }
    assert.doesNotThrow(() => assertGuidePrebuilt(root));
    const output = join(root, '.vercel/output/static/guides', images[0]);
    writeFileSync(output, '<html>store not found</html>');
    assert.throws(() => assertGuidePrebuilt(root), /differs/);
    rmSync(output);
    assert.throws(() => assertGuidePrebuilt(root), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
