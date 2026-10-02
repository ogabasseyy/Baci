import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('rejects embedded credentials in allowlisted URLs without echoing them', () => {
  const allow = '# seeded\nKV_REST_API_URL\nGO54_EMAIL\n';
  withFiles(
    'KV_REST_API_URL="https://relaxed-rail-123.upstash.io"\nGO54_EMAIL="ops@example.com"\n',
    allow,
    (envFile, allowFile) => {
      assert.equal(run(envFile, allowFile).status, 0);
    }
  );
  withFiles('KV_REST_API_URL="redis://default:hunter2@host:6379"\n', allow, (envFile, allowFile) => {
    const result = run(envFile, allowFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /KV_REST_API_URL/);
    assert.doesNotMatch(result.stderr, /hunter2/);
  });
  withFiles('KV_REST_API_URL="https://edge-config.vercel.com/ecfg?token=abc"\n', allow, (envFile, allowFile) => {
    const result = run(envFile, allowFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /embeds credentials/);
  });
  withFiles('KV_REST_API_URL=""\n', allow, (envFile, allowFile) => {
    assert.equal(run(envFile, allowFile).status, 0);
  });
});

test('redact patterns blank export-prefixed privileged keys', () => {
  const redactPatterns = fileURLToPath(
    new URL('./preview-env-redact.sed', import.meta.url),
  );
  const directory = mkdtempSync(join(tmpdir(), 'preview-env-redact-'));
  try {
    const envFile = join(directory, '.env.preview.local');
    writeFileSync(
      envFile,
      'export CRON_SECRET="real"\nexport KV_REST_API_URL="https://x.upstash.io"\n'
    );
    const sed = spawnSync('sed', ['-E', '-f', redactPatterns, envFile], {
      encoding: 'utf8',
    });
    assert.equal(sed.status, 0, sed.stderr);
    assert.match(sed.stdout, /^CRON_SECRET=\"\"$/m);
    assert.doesNotMatch(sed.stdout, /real/);
    assert.match(sed.stdout, /^KV_REST_API_URL="https:\/\/x\.upstash\.io"$/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts the export-prefixed assignment form', () => {
  withFiles('export NEXT_PUBLIC_SHOP="ogabassey"\nexport CRON_SECRET=""\n', '# seeded\nCRON_SECRET\n', (envFile, allowFile) => {
    const result = run(envFile, allowFile);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('rejects userinfo in public URLs but allows public query strings', () => {
  withFiles('NEXT_PUBLIC_API_URL="https://api.example.com/v1?key=public"\n', '', (envFile, allowFile) => {
    assert.equal(run(envFile, allowFile).status, 0);
  });
  withFiles('NEXT_PUBLIC_API_URL="https://user:pass@api.example.com"\n', '', (envFile, allowFile) => {
    const result = run(envFile, allowFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NEXT_PUBLIC_API_URL/);
    assert.doesNotMatch(result.stderr, /user:pass/);
  });
});

test('accepts the real pull-output shape through normalize, redact, and exposure check', () => {
  const fixture = fileURLToPath(
    new URL('./fixtures/preview-env-pull-shape.fixture.env', import.meta.url),
  );
  const redactPatterns = fileURLToPath(
    new URL('./preview-env-redact.sed', import.meta.url),
  );
  const allowlist = fileURLToPath(
    new URL('./preview-env-allowlist.txt', import.meta.url),
  );
  const directory = mkdtempSync(join(tmpdir(), 'preview-env-shape-'));
  try {
    const envFile = join(directory, '.env.preview.local');
    copyFileSync(fixture, envFile);
    // Same order as the workflow: normalize sensitive tokens, redact
    // privileged keys, then run the exposure check. No sed -i (BSD/GNU
    // differ); the normalize pattern must mirror preview.yml.
    for (const args of [
      ['-E', 's/=["\']?\\[SENSITIVE[[:blank:]]*\\]["\']?[[:space:]]*$/=""/', envFile],
      ['-E', '-f', redactPatterns, envFile],
    ]) {
      const sed = spawnSync('sed', args, { encoding: 'utf8' });
      assert.equal(sed.status, 0, sed.stderr);
      writeFileSync(envFile, sed.stdout);
    }
    const result = spawnSync('node', [SCRIPT, envFile, allowlist], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const final = readFileSync(envFile, 'utf8');
    assert.doesNotMatch(final, /fixture-redacted-secret/);
    assert.match(final, /FIXTURE_SENSITIVE_TOKEN=""/);
    assert.match(final, /fixture-safe-value/);
    // Cache-mode ownership keys are deleted from the file (not blanked),
    // so the build job's TURBO_CACHE is uncontested by construction.
    assert.doesNotMatch(final, /^TURBO_CACHE=/m);
    assert.doesNotMatch(final, /^TURBO_REMOTE_ONLY=/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('redacted build env is accepted by turbo with the job cache mode', () => {
  const fixture = fileURLToPath(
    new URL('./fixtures/preview-env-pull-shape.fixture.env', import.meta.url),
  );
  const redactPatterns = fileURLToPath(
    new URL('./preview-env-redact.sed', import.meta.url),
  );
  const directory = mkdtempSync(join(tmpdir(), 'preview-env-turbo-'));
  try {
    const envFile = join(directory, '.env.preview.local');
    copyFileSync(fixture, envFile);
    for (const args of [
      ['-E', 's/=["\']?\\[SENSITIVE[[:blank:]]*\\]["\']?[[:space:]]*$/=""/', envFile],
      ['-E', '-f', redactPatterns, envFile],
    ]) {
      const sed = spawnSync('sed', args, { encoding: 'utf8' });
      assert.equal(sed.status, 0, sed.stderr);
      writeFileSync(envFile, sed.stdout);
    }
    // Offer the redacted file to turbo exactly as `vercel build` would,
    // plus the job-level cache mode read from the workflow (fail closed
    // if the step ever drifts or duplicates the key).
    // The file carries no TURBO_CACHE/TURBO_REMOTE_ONLY (deleted, not
    // blanked), so no step-vs-file precedence is assumed here.
    const workflowText = readFileSync(
      fileURLToPath(new URL('../workflows/preview.yml', import.meta.url)),
      'utf8'
    );
    const cacheModes = [
      ...workflowText.matchAll(/^\s*TURBO_CACHE:\s*"([^"]+)"\s*$/gm),
    ].map((match) => match[1]);
    assert.equal(
      cacheModes.length,
      1,
      'build job must set exactly one TURBO_CACHE'
    );
    // Purge ambient TURBO_* so only the redacted file plus the job cache
    // mode reach turbo: --dry must prove hermetic, offline acceptance.
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('TURBO_')) delete env[key];
    }
    for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
      const match = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(
        rawLine.trim()
      );
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    }
    env.TURBO_CACHE = cacheModes[0];
    const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
    const dry = spawnSync(
      'pnpm',
      ['exec', 'turbo', 'build', '--filter=@baci/web', '--dry=json'],
      {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    assert.equal(dry.status, 0, (dry.stderr || '').slice(-2000));
    assert.doesNotMatch(dry.stderr || '', /Cannot set `cache` config/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
