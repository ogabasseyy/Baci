import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Hermetic regression for the preview build's turbo cache-mode conflict:
// the pulled env file must carry no TURBO_CACHE/TURBO_REMOTE_ONLY, and the
// job-level mode alone must be accepted across sibling-flag states.
// Requires installed deps (pnpm exec turbo); runs in CI after install.
test('redacted build env is accepted by turbo with the job cache mode', (t) => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const probe = spawnSync('pnpm', ['exec', 'turbo', '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (probe.status !== 0) {
    t.skip('turbo toolchain unavailable');
    return;
  }
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
    // if the step ever drifts or duplicates the key; either quote style).
    // The file carries no TURBO_CACHE/TURBO_REMOTE_ONLY (deleted, not
    // blanked), so no step-vs-file precedence is assumed here.
    const workflowText = readFileSync(
      fileURLToPath(new URL('../workflows/preview.yml', import.meta.url)),
      'utf8'
    );
    const cacheModes = [
      ...workflowText.matchAll(/^\s*TURBO_CACHE:\s*["']([^"']+)["']\s*$/gm),
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
    // Prove every sibling-flag state, not just the fixture's true/true.
    for (const download of ['true', 'false']) {
      for (const summary of ['true', 'false']) {
        env.TURBO_DOWNLOAD_LOCAL_ENABLED = download;
        env.TURBO_RUN_SUMMARY = summary;
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
        assert.equal(
          dry.status,
          0,
          `flags ${download}/${summary}: ${(dry.stderr || '').slice(-2000)}`
        );
        assert.doesNotMatch(
          dry.stderr || '',
          /Cannot set [`']?cache[`']? config/
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
