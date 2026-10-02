import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./materialize-preview-prebuilt-refs.mjs', import.meta.url),
);
const QUARANTINE = '.preview-refs-quarantine';

function layout(files, links = {}) {
  const root = mkdtempSync(join(tmpdir(), 'preview-materialize-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, QUARANTINE, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  for (const [rel, target] of Object.entries(links)) {
    const full = join(root, QUARANTINE, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    symlinkSync(target, full);
  }
  return root;
}

function run(root) {
  return spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
}

test('materializes quarantined refs at root-relative paths', () => {
  const root = layout({
    'node_modules/left-pad/index.js': 'module.exports = 1;',
    '.preview-refs-manifest.json': '{"refs":[]}',
  });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(root, 'node_modules/left-pad/index.js'), 'utf8'),
      'module.exports = 1;'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const hostile of [
  'trusted-ops/.github/scripts/preview-deploy-run.sh',
  'trusted-ops',
  '.vercel/project.json',
  '.vercel/.env.preview.local',
  '.preview-refs-quarantine/nested.js',
]) {
  test(`refuses denied path: ${hostile}`, () => {
    const root = layout({ [hostile]: 'evil' });
    try {
      const result = run(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /denied/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('refuses symlinks without following them', () => {
  const root = layout(
    { 'node_modules/real/index.js': 'real' },
    { 'node_modules/evil.js': '/etc/passwd' }
  );
  try {
    const before = readFileSync(join(root, QUARANTINE, 'node_modules/real/index.js'), 'utf8');
    assert.equal(before, 'real');
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a regular file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports the materialized count to the step summary', () => {
  const root = layout({ 'node_modules/ok/index.js': 'ok' });
  try {
    const summary = join(root, 'summary.md');
    writeFileSync(summary, '');
    const result = spawnSync('node', [SCRIPT, root], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(summary, 'utf8'),
      /Prebuilt refs materialized: 1 file/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on a missing quarantine dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'preview-materialize-empty-'));
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /quarantine dir missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
