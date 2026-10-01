import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./assert-preview-env-allowlist.mjs', import.meta.url),
);

function withFiles(envContents, allowContents, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'assert-preview-allowlist-'));
  const envFile = join(directory, '.env.preview.local');
  const allowFile = join(directory, 'allowlist.txt');
  writeFileSync(envFile, envContents);
  writeFileSync(allowFile, allowContents);

  try {
    callback(envFile, allowFile);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(envFile, allowFile) {
  return spawnSync('node', [SCRIPT, envFile, allowFile], {
    encoding: 'utf8',
  });
}

test('accepts public, blank, and allowlisted assignments', () => {
  withFiles(
    'NEXT_PUBLIC_SHOP="ogabassey"\nQUIZ_RPC_SERVER_SECRET=""\nCRON_SECRET="real"\n# comment\n\n',
    '# seeded\nCRON_SECRET\n',
    (envFile, allowFile) => {
      const result = run(envFile, allowFile);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /no unexpected real server values/);
    },
  );
});

test('fails on an unknown non-blank server key without printing its value', () => {
  withFiles(
    'NEXT_PUBLIC_SHOP="ogabassey"\nBRAND_NEW_API_KEY="super-secret-value"\n',
    '# seeded\nCRON_SECRET\n',
    (envFile, allowFile) => {
      const result = run(envFile, allowFile);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /BRAND_NEW_API_KEY/);
      assert.doesNotMatch(result.stderr, /super-secret-value/);
      assert.doesNotMatch(result.stdout, /super-secret-value/);
    },
  );
});

test('fails closed on unparseable lines without echoing content', () => {
  withFiles(
    'NEXT_PUBLIC_SHOP="ogabassey"\nnot a valid assignment at all\n',
    '',
    (envFile, allowFile) => {
      const result = run(envFile, allowFile);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unparseable line 2/);
      assert.doesNotMatch(result.stderr, /not a valid assignment/);
    },
  );
});

test('treats interpolation as a real value unless allowlisted', () => {
  withFiles('DERIVED="${BASE}/path"\n', '', (envFile, allowFile) => {
    const failed = run(envFile, allowFile);
    assert.equal(failed.status, 1);
  });
  withFiles('DERIVED="${BASE}/path"\n', 'DERIVED\n', (envFile, allowFile) => {
    const passed = run(envFile, allowFile);
    assert.equal(passed.status, 0, passed.stderr);
  });
});

test('rejects a non-blank duplicate even when one assignment is blank', () => {
  withFiles('DUPED=""\nDUPED="real"\n', '', (envFile, allowFile) => {
    const result = run(envFile, allowFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DUPED/);
  });
});

test('exits nonzero when inputs are missing', () => {
  const missing = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  withFiles('', '', (envFile) => {
    const unreadable = spawnSync(
      'node',
      [SCRIPT, envFile, join(envFile, 'nope.txt')],
      { encoding: 'utf8' },
    );
    assert.equal(unreadable.status, 2);
  });
});
