import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const script = join(directory, 'resolve-gigl-latch-identity.sh');
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

const fingerprintOf = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function resolve({ envFile = null, processEnv = {} }) {
  const remote = mkdtempSync(join(tmpdir(), 'baci-gigl-identity-'));
  temporaryDirectories.push(remote);
  if (envFile !== null) {
    writeFileSync(join(remote, '.env'), envFile);
  }
  const env = { ...process.env };
  delete env.GIGL_ENABLED;
  delete env.GIGL_TRACKING_WORKER_TOKEN;
  Object.assign(env, processEnv);
  const result = spawnSync('bash', [script, remote], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  const [scope, fingerprint] = result.stdout.trim().split(' ');
  return { scope, fingerprint };
}

describe('GIGL latch identity resolver', () => {
  for (const value of ['0', 'false', 'off', 'FALSE', ' Off ', '"off"', "'0'"]) {
    it(`reports disabled scope for ${JSON.stringify(value)}`, () => {
      const { scope } = resolve({ envFile: `GIGL_ENABLED=${value}\n` });
      assert.equal(scope, 'disabled');
    });
  }

  for (const value of ['1', 'true', 'on', '', 'nope', 'o ff']) {
    it(`reports enabled scope for ${JSON.stringify(value)}`, () => {
      const { scope } = resolve({ envFile: `GIGL_ENABLED=${value}\n` });
      assert.equal(scope, 'enabled');
    });
  }

  it('reports enabled scope when the env file is missing or lacks the key', () => {
    assert.equal(resolve({}).scope, 'enabled');
    assert.equal(resolve({ envFile: 'OTHER=1\n' }).scope, 'enabled');
  });

  it('prefers a set process variable over the file, even when empty', () => {
    assert.equal(
      resolve({
        envFile: 'GIGL_ENABLED=off\n',
        processEnv: { GIGL_ENABLED: '1' },
      }).scope,
      'enabled'
    );
    // dotenv keeps an explicitly-set empty var instead of the file value.
    assert.equal(
      resolve({ envFile: 'GIGL_ENABLED=off\n', processEnv: { GIGL_ENABLED: '' } })
        .scope,
      'enabled'
    );
  });

  it('fingerprints the effective worker token', () => {
    const { fingerprint } = resolve({
      envFile: 'GIGL_TRACKING_WORKER_TOKEN=aaa.bbb.ccc\n',
    });
    assert.equal(fingerprint, fingerprintOf('aaa.bbb.ccc'));
  });

  it('fingerprints the empty string when the token is absent', () => {
    const { fingerprint } = resolve({ envFile: 'GIGL_ENABLED=off\n' });
    assert.equal(fingerprint, fingerprintOf(''));
  });

  it('strips one quote layer from file token values', () => {
    const { fingerprint } = resolve({
      envFile: 'GIGL_TRACKING_WORKER_TOKEN="aaa.bbb.ccc"\n',
    });
    assert.equal(fingerprint, fingerprintOf('aaa.bbb.ccc'));
  });

  it('prefers a set process token over the file token', () => {
    const { fingerprint } = resolve({
      envFile: 'GIGL_TRACKING_WORKER_TOKEN=file-token\n',
      processEnv: { GIGL_TRACKING_WORKER_TOKEN: 'proc-token' },
    });
    assert.equal(fingerprint, fingerprintOf('proc-token'));
  });

  // dotenv subset parity with the capability smoke (dotenv 17.4.2):
  // export prefix, surrounding whitespace, trailing comments, and
  // last-assignment-wins must resolve exactly as dotenv parses them,
  // or the latch identity disagrees with the smoke it recorded.
  for (const line of [
    'export GIGL_ENABLED=off',
    '  GIGL_ENABLED=off',
    'GIGL_ENABLED=off # comment',
    'GIGL_ENABLED = off',
    'export  GIGL_ENABLED="off" # rotated',
  ]) {
    it(`reports disabled scope for dotenv form ${JSON.stringify(line)}`, () => {
      const { scope } = resolve({ envFile: `${line}\n` });
      assert.equal(scope, 'disabled');
    });
  }

  it('lets the last assignment win, like dotenv', () => {
    assert.equal(
      resolve({ envFile: 'GIGL_ENABLED=on\nGIGL_ENABLED=off\n' }).scope,
      'disabled'
    );
    assert.equal(
      resolve({ envFile: 'GIGL_ENABLED=off\nGIGL_ENABLED=on\n' }).scope,
      'enabled'
    );
  });

  it('ignores lookalike keys and comment lines', () => {
    assert.equal(
      resolve({ envFile: '# GIGL_ENABLED=off\nGIGL_ENABLED_FOO=off\n' }).scope,
      'enabled'
    );
  });

  it('strips trailing comments from file token values, like dotenv', () => {
    const { fingerprint } = resolve({
      envFile: 'GIGL_TRACKING_WORKER_TOKEN=aaa.bbb.ccc # rotated\n',
    });
    assert.equal(fingerprint, fingerprintOf('aaa.bbb.ccc'));
  });

  it('keeps hashes inside quoted token values, like dotenv', () => {
    const { fingerprint } = resolve({
      envFile: 'GIGL_TRACKING_WORKER_TOKEN="aaa#bbb"\n',
    });
    assert.equal(fingerprint, fingerprintOf('aaa#bbb'));
  });
});
