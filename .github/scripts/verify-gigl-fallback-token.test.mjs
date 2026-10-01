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

function runExpectingInjectorRefusal(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'gigl-fallback-token-'));
  try {
    const file = join(dir, '.env.production.local');
    writeFileSync(file, contents);
    try {
      execFileSync('bash', [script, file], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // Must fail in the injector (absent key), not in the flag probe.
      assert.match(String(error.stderr ?? ''), /is absent in/);
      return;
    }
    assert.fail('expected a non-zero exit');
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

  for (const line of [
    'export GIGL_ENABLED=off',
    '  GIGL_ENABLED=off',
    'GIGL_ENABLED=off # comment',
    'GIGL_ENABLED = off',
  ]) {
    it(`skips injection for dotenv form ${JSON.stringify(line)}`, () => {
      const { stdout } = runWithDotenv(`${line}\n`);

      assert.match(stdout, /skipping fallback token injection/);
    });
  }

  it('treats an unset flag as enabled and fails closed on a missing token', () => {
    runExpectingInjectorRefusal('GIGL_ENABLED=\n');
    runExpectingInjectorRefusal('OTHER_KEY=1\n');
  });

  it('keeps hashes inside quotes (dotenv), so "off#x" stays enabled', () => {
    // A naive `#`-cut would misread this as off and skip injection,
    // leaving the fallback route without a token entry (runtime 500).
    runExpectingInjectorRefusal('GIGL_ENABLED="off#x"\n');
  });

  it('treats a missing flag as enabled when the token is configured', () => {
    const { stdout, updated } = runWithDotenv(
      'GIGL_TRACKING_WORKER_TOKEN=\n'
    );

    assert.match(stdout, /build-time stand-in/);
    assert.match(
      updated,
      /GIGL_TRACKING_WORKER_TOKEN="build-time-presence-stand-in-not-used-at-runtime-000000000000"/
    );
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
