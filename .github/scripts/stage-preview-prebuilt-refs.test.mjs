import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./stage-preview-prebuilt-refs.mjs', import.meta.url),
);

function layout(files) {
  const root = mkdtempSync(join(tmpdir(), 'preview-refs-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('stages referenced files preserving root-relative layout', () => {
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/out.js': 'node_modules/left-pad/index.js',
        '/deep.js': 'packages/app/lib/deep.js',
      },
    }),
    'node_modules/left-pad/index.js': 'module.exports = 1;',
    'packages/app/lib/deep.js': 'export const x = 2;',
  });
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(join(stage, 'node_modules/left-pad/index.js'), 'utf8'),
      'module.exports = 1;'
    );
    assert.equal(
      readFileSync(join(stage, 'packages/app/lib/deep.js'), 'utf8'),
      'export const x = 2;'
    );
    const manifest = JSON.parse(
      readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.refs, [
      'node_modules/left-pad/index.js',
      'packages/app/lib/deep.js',
    ]);
    assert.deepEqual(manifest.skipped, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips absolute, escaping, internal, and protected references', () => {
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/a.js': '/etc/passwd',
        '/b.js': '../../outside.js',
        '/c.js': '.vercel/output/functions/a.func/bundled.js',
        '/d.js': 'trusted-ops/.github/scripts/preview-deploy-run.sh',
        '/e.js': '.vercel/project.json',
        '/ok.js': 'node_modules/ok/index.js',
      },
    }),
    '.vercel/output/functions/a.func/bundled.js': 'bundled',
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(
      readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.refs, ['node_modules/ok/index.js']);
    assert.deepEqual(
      manifest.skipped.map((s) => s.reason).sort(),
      ['absolute', 'escapes-root', 'inside-output', 'protected-path', 'protected-path']
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on missing references and missing output', () => {
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: { '/gone.js': 'node_modules/gone/index.js' },
    }),
  });
  try {
    const missing = spawnSync('node', [SCRIPT, root, join(root, 's1')], {
      encoding: 'utf8',
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing from the source tree/);
    const empty = layout({});
    try {
      const noOutput = spawnSync('node', [SCRIPT, empty, join(empty, 's2')], {
        encoding: 'utf8',
      });
      assert.equal(noOutput.status, 1);
      assert.match(noOutput.stderr, /output dir missing/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writes a manifest even when nothing is referenced', () => {
  const root = layout({
    '.vercel/output/static/index.html': '<h1>hi</h1>',
  });
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(
      readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.refs, []);
    assert.deepEqual(manifest.skipped, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
