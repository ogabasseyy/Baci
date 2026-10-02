import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./stage-preview-prebuilt-refs.mjs', import.meta.url),
);

function layout(files) {
  const root = mkdtempSync(join(tmpdir(), 'preview-refs-harden-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('drops final-component links escaping the root', () => {
  // A final link to an outside-root target resolves, fails root
  // validation, and drops: the deploy tree has no such link, so the
  // CLI would ENOENT re-adding the innocent-looking value.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/evil.js': 'node_modules/evil.js',
        '/ok.js': 'node_modules/ok/index.js',
        '/ok2.js': 'node_modules/ok2/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
    'node_modules/ok2/index.js': 'ok2',
  });
  const outside = mkdtempSync(join(tmpdir(), 'preview-refs-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'node_modules/evil.js'));
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const rewritten = JSON.parse(readFileSync(join(root, configRel), 'utf8'));
    assert.deepEqual(Object.keys(rewritten.filePathMap).sort(), ['/ok.js', '/ok2.js']);
    const manifest = JSON.parse(readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.skipped, [{ value: 'node_modules/evil.js', reason: 'escaped-link' }]);
    assert.match(run.stderr, /WARNING: dropped 1 dangling reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('stages through inside-root final-component links', () => {
  // A final link to an inside-root regular file resolves and stages
  // like any other file; only escaping links drop.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/linked.js': 'node_modules/linked.js',
        '/ok.js': 'node_modules/ok/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
    'real/file.js': 'linked-bytes',
  });
  symlinkSync(join(root, 'real/file.js'), join(root, 'node_modules/linked.js'));
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(stage, 'node_modules/linked.js'), 'utf8'), 'linked-bytes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses ancestor symlinks escaping the root', () => {
  // lstat alone only sees the final component: an intermediate symlink
  // to an outside-root target must not launder bytes into staging.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/leak.js': 'node_modules/leak/secret.txt',
        '/ok.js': 'node_modules/ok/index.js',
        '/ok2.js': 'node_modules/ok2/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
    'node_modules/ok2/index.js': 'ok2',
  });
  const outside = mkdtempSync(join(tmpdir(), 'preview-refs-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, join(root, 'node_modules/leak'));
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.skipped, [{ value: 'node_modules/leak/secret.txt', reason: 'escaped-link' }]);
    assert.deepEqual(manifest.refs, ['node_modules/ok/index.js', 'node_modules/ok2/index.js']);
    const rewritten = JSON.parse(readFileSync(join(root, configRel), 'utf8'));
    assert.deepEqual(Object.keys(rewritten.filePathMap).sort(), ['/ok.js', '/ok2.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('stages through inside-root ancestor symlinks', () => {
  // pnpm-style layouts link package dirs inside the root: resolving
  // through them still stages bytes at the lexical map path.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/linked.js': 'node_modules/pkg/index.js',
        '/ok.js': 'node_modules/ok/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
    'real/pkg/index.js': 'linked-bytes',
  });
  symlinkSync(join(root, 'real/pkg'), join(root, 'node_modules/pkg'));
  try {
    const stage = join(root, 'stage');
    const run = spawnSync('node', [SCRIPT, root, stage], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(stage, 'node_modules/pkg/index.js'), 'utf8'), 'linked-bytes');
    const manifest = JSON.parse(readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.skipped, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to ship on a phantom tie', () => {
  // One phantom plus one resolving file is a tie: wrong drops surface
  // as runtime failures, so ties fail closed.
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/gone.js': 'node_modules/gone/index.js',
        '/ok.js': 'node_modules/ok/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /1 missing reference\(s\) vs 1 resolving; refusing to ship/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizes dangling values in the stderr warning', () => {
  // Build-controlled values reach stderr: newlines/escapes must not be
  // able to spoof CI log lines, and long values must be truncated.
  const evil = `node_modules/\u001b[31mred\nFAKEERROR\x7f\u202e\n${'y'.repeat(250)}.js`;
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/evil.js': evil,
        '/ok.js': 'node_modules/ok/index.js',
        '/ok2.js': 'node_modules/ok2/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
    'node_modules/ok2/index.js': 'ok2',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(!run.stderr.includes('\nFAKEERROR\n'));
    assert.ok(!run.stderr.includes('y'.repeat(201)));
    assert.ok(!run.stderr.includes('\x1b'));
    assert.ok(!run.stderr.includes('\x7f'));
    assert.ok(!run.stderr.includes('\u202e'));
    assert.match(run.stderr, /\[31mredFAKEERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps a __proto__ filePathMap key', () => {
  // The rebuilt map must preserve hostile keys as own properties, not
  // silently drop them through the Object prototype.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: '{"filePathMap":{"__proto__":"node_modules/proto/index.js","/ok.js":"node_modules/ok/index.js"}}',
    'node_modules/proto/index.js': 'proto',
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const rewritten = JSON.parse(readFileSync(join(root, configRel), 'utf8')).filePathMap;
    assert.ok(Object.hasOwn(rewritten, '__proto__'));
    assert.equal(rewritten['__proto__'], 'node_modules/proto/index.js');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sweeps stale rewrite temp files first', () => {
  // A leftover temp file from a killed run is removed before the new
  // two-phase rewrite, so stale files never pile up in the output tree.
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: { '/gone.js': 'node_modules/gone/index.js', '/ok.js': 'node_modules/ok/index.js', '/ok2.js': 'node_modules/ok2/index.js' },
    }),
    [`${configRel}.tmp-stage-refs`]: 'stale',
    'node_modules/ok/index.js': 'ok',
    'node_modules/ok2/index.js': 'ok2',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      readdirSync(join(root, '.vercel/output/functions/a.func')).filter((n) => n.includes('.tmp-')),
      []
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rewrites configs without leaving temp files', () => {
  // Rewrites go through temp-file plus rename per config: a mid-loop
  // throw cannot leave a half-written map, and success leaves no
  // temp files behind in the output tree.
  const configA = '.vercel/output/functions/a.func/.vc-config.json';
  const configB = '.vercel/output/functions/b.func/.vc-config.json';
  const root = layout({
    [configA]: JSON.stringify({
      filePathMap: { '/gone.js': 'node_modules/gone/index.js', '/ok.js': 'node_modules/ok/index.js' },
    }),
    [configB]: JSON.stringify({
      filePathMap: { '/gone2.js': 'node_modules/gone2/index.js', '/ok2.js': 'node_modules/ok2/index.js', '/ok3.js': 'node_modules/ok3/index.js' },
    }),
    'node_modules/ok/index.js': 'ok',
    'node_modules/ok2/index.js': 'ok2',
    'node_modules/ok3/index.js': 'ok3',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(root, configA), 'utf8')).filePathMap, {
      '/ok.js': 'node_modules/ok/index.js',
    });
    assert.deepEqual(JSON.parse(readFileSync(join(root, configB), 'utf8')).filePathMap, {
      '/ok2.js': 'node_modules/ok2/index.js',
      '/ok3.js': 'node_modules/ok3/index.js',
    });
    for (const dir of ['a.func', 'b.func']) {
      const leftovers = readdirSync(join(root, '.vercel/output/functions', dir)).filter((n) => n.includes('.tmp-'));
      assert.deepEqual(leftovers, []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
