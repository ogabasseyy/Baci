import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const script = join(directory, 'verify-gigl-fallback-token.sh');
const repoRoot = join(directory, '..', '..');

function runWithDotenv(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'gigl-fallback-token-'));
  try {
    const file = join(dir, '.env.production.local');
    writeFileSync(file, contents);
    const stdout = execFileSync('bash', [script, file], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return { stdout, updated: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function runExpectingFailure(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'gigl-fallback-token-'));
  try {
    const file = join(dir, '.env.production.local');
    writeFileSync(file, contents);
    assert.throws(() =>
      execFileSync('bash', [script, file], { cwd: repoRoot, stdio: 'pipe' })
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

describe('verify gigl fallback token', () => {
  for (const value of ['0', 'false', 'off', 'OFF']) {
    it(`skips injection when GIGL is explicitly disabled (${value})`, () => {
      const { stdout } = runWithDotenv(`GIGL_ENABLED=${value}\n`);

      assert.match(stdout, /skipping fallback token injection/);
    });
  }

  it('treats an unset flag as enabled and fails closed on a missing token', () => {
    runExpectingFailure('GIGL_ENABLED=\n');
    runExpectingFailure('OTHER_KEY=1\n');
  });

  it('injects the build-time stand-in over a blank pulled token', () => {
    const { stdout, updated } = runWithDotenv(
      'GIGL_ENABLED=true\nGIGL_TRACKING_WORKER_TOKEN=\n'
    );

    assert.match(stdout, /build-time stand-in/);
    assert.match(
      updated,
      /GIGL_TRACKING_WORKER_TOKEN="build-time-presence-stand-in-not-used-at-runtime-000000000000"/
    );
  });
});
