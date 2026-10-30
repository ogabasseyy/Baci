import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  linuxOnly,
  migrate,
  releaseDir,
} from './release-host.test-fixtures.mjs';

test(
  'migrates the worker environment without deployment credentials',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      [
        '# comment',
        'GIGL_TRACKING_WORKER_TOKEN=keep-me',
        'export GITHUB_PERSONAL_ACCESS_TOKEN=drop-1',
        'SUPABASE_ACCESS_TOKEN=drop-2',
        'VERCEL_OIDC_TOKEN=drop-3',
        'BACI_REMEDIATION_OUTPUT_DIR=/home/deploy/x',
        'BACI_REPO_DIR=/home/deploy/app-live',
        'VERCEL_ERROR_LOG_PATH=/home/deploy/baci-workers/logs/vercel-drain.jsonl',
        '',
      ].join('\n')
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        '# comment',
        'GIGL_TRACKING_WORKER_TOKEN=keep-me',
        'BACI_REPO_DIR=/srv/w/app-live',
        'VERCEL_ERROR_LOG_PATH=/srv/w/baci-workers/logs/vercel-drain.jsonl',
        '',
      ].join('\n')
    );
  }
);

test(
  'refuses to migrate a kept setting that still points into the deploy home',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'SECRET_VALUE=abc\nSOME_PATH=/home/deploy/elsewhere\n'
    );

    const result = migrate(envFile);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SOME_PATH still points into \/home\/deploy/);
    assert.doesNotMatch(result.stderr + result.stdout, /abc/);
  }
);

test(
  'bugfix: drops credentials written with dotenv spacing or colon syntax',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'GITHUB_TOKEN = drop-1\nexport SUPABASE_ACCESS_TOKEN: drop-2\nKEEP = yes\n'
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'KEEP = yes\n');
    const check = spawnSync(
      'bash',
      [
        '-c',
        `source "${join(releaseDir, 'provision-host.sh')}" && has_dropped_key "$1"`,
        'x',
        envFile,
      ],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }
    );
    assert.equal(
      check.status,
      0,
      'the readiness check must detect spaced credentials'
    );
  }
);

test(
  'bugfix: maps a nested legacy app-live checkout to the release symlink',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'BACI_REPO_DIR=/home/deploy/baci-workers/app-live\n'
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'BACI_REPO_DIR=/srv/w/app-live\n');
  }
);
