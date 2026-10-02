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
  const root = mkdtempSync(join(tmpdir(), 'preview-refs-guard-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('counts repeated phantom occurrences, not distinct values', () => {
  // Same phantom twice plus one staged file must fail: 2 occurrences
  // dominate 1 resolving. A deduped (Set-based) guard would see 1 vs 1
  // and ship, so this pins the occurrence-counting behavior.
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/x.js': 'node_modules/gone/index.js',
        '/y.js': 'node_modules/gone/index.js',
      },
    }),
    '.vercel/output/functions/b.func/.vc-config.json': JSON.stringify({
      filePathMap: { '/ok.js': 'node_modules/ok/index.js' },
    }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refusing to ship/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drops stale output-internal refs instead of counting them', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/stale.js': '.vercel/output/functions/a.func/missing.js',
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
    const rewritten = JSON.parse(readFileSync(join(root, configRel), 'utf8'));
    assert.deepEqual(rewritten.filePathMap, { '/ok.js': 'node_modules/ok/index.js', '/ok2.js': 'node_modules/ok2/index.js' });
    const manifest = JSON.parse(
      readFileSync(join(root, 'stage', '.preview-refs-manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.skipped, [
      {
        value: '.vercel/output/functions/a.func/missing.js',
        reason: 'missing',
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('traces directory refs as non-file, still unresolved', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/dir.js': 'node_modules/ok',
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
    const rewritten = JSON.parse(readFileSync(join(root, configRel), 'utf8'));
    assert.deepEqual(rewritten.filePathMap, { '/ok.js': 'node_modules/ok/index.js', '/ok2.js': 'node_modules/ok2/index.js' });
    const manifest = JSON.parse(
      readFileSync(join(root, 'stage', '.preview-refs-manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.skipped, [
      { value: 'node_modules/ok', reason: 'non-file' },
    ]);
    assert.match(run.stderr, /WARNING: dropped 1 dangling reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('absolute and escaping refs do not satisfy the usable guard', () => {
  // Global ratio passes (1 missing vs 2 staged); the broken function is
  // kept only by CLI-rejected absolute/escaping entries, so the
  // per-config total-loss check must fire.
  const root = layout({
    '.vercel/output/functions/healthy.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/1.js': 'node_modules/a/one.js',
        '/2.js': 'node_modules/a/two.js',
      },
    }),
    '.vercel/output/functions/broken.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/abs.js': '/etc/passwd',
        '/esc.js': '../../outside.js',
        '/gone.js': 'node_modules/gone/index.js',
      },
    }),
    'node_modules/a/one.js': '1',
    'node_modules/a/two.js': '2',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /lost every usable reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('leaves maps untouched when a guardrail fails', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const original = JSON.stringify({
    filePathMap: {
      '/gone.js': 'node_modules/gone/index.js',
      '/gone2.js': 'node_modules/gone2/index.js',
    },
  });
  const root = layout({ [configRel]: original });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    // A same-workspace retry must see the original maps, not truncated ones.
    assert.equal(readFileSync(join(root, configRel), 'utf8'), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('warns about protected and invalid drops that pass the guards', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({
      filePathMap: {
        '/p.js': 'trusted-ops/evil.js',
        '/i.js': 42,
        '/ok.js': 'node_modules/ok/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const summary = join(root, 'summary.md');
    writeFileSync(summary, '');
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stderr,
      /WARNING: dropped 1 protected-path and 1 invalid entries/
    );
    assert.match(run.stderr, /::warning::Dropped 1 protected-path and 1 invalid/);
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /\(0 dangling, 1 protected, 1 invalid\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate staged refs do not mask distinct phantoms', () => {
  // One real file referenced three times plus two distinct phantoms
  // must fail: resolving counts distinct files (1), not occurrences
  // (3), so the 2 missing dominate.
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/a.js': 'node_modules/ok/index.js',
        '/b.js': 'node_modules/ok/index.js',
        '/c.js': 'node_modules/ok/index.js',
        '/gone.js': 'node_modules/gone/index.js',
        '/gone2.js': 'node_modules/gone2/index.js',
      },
    }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refusing to ship/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes output-internal aliases in the resolving count', () => {
  // Two alias spellings of one file plus two missing refs must fail:
  // normalized resolving is 1, so the 2 missing dominate.
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: {
        '/a.js': '.vercel/output/functions/a.func/bundled.js',
        '/b.js': '.vercel/output/functions/a.func/sub/../bundled.js',
        '/gone.js': 'node_modules/gone/index.js',
        '/gone2.js': 'node_modules/gone2/index.js',
      },
    }),
    '.vercel/output/functions/a.func/bundled.js': 'bundled',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refusing to ship/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a non-object filePathMap', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const root = layout({
    [configRel]: JSON.stringify({ filePathMap: 'node_modules/ok/index.js' }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /filePathMap is not an object/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tolerates an unwritable step summary', () => {
  const root = layout({
    '.vercel/output/functions/a.func/.vc-config.json': JSON.stringify({
      filePathMap: { '/ok.js': 'node_modules/ok/index.js' },
    }),
    'node_modules/ok/index.js': 'ok',
  });
  try {
    // A directory summary path makes the append throw; best-effort only.
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: root },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /WARNING: could not write step summary/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an array filePathMap instead of coercing it', () => {
  const configRel = '.vercel/output/functions/a.func/.vc-config.json';
  const original = JSON.stringify({ filePathMap: ['node_modules/ok/index.js'] });
  const root = layout({
    [configRel]: original,
    'node_modules/ok/index.js': 'ok',
  });
  try {
    const run = spawnSync('node', [SCRIPT, root, join(root, 'stage')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /filePathMap is not an object/);
    assert.equal(readFileSync(join(root, configRel), 'utf8'), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
