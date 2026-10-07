import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('worker denies remote Docker and inherited database settings before replay', () => {
  for (const environment of [
    { DOCKER_HOST: 'ssh://remote' },
    { DOCKER_HOST: 'unix:///var/run/docker.sock', PGHOST: 'remote' },
    {
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      DOCKER_CONTEXT: 'production',
    },
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(
          new URL('./hosted-savings-bootstrap-worker.ts', import.meta.url)
        ),
      ],
      { env: { PATH: process.env.PATH, ...environment }, encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Isolated local bootstrap worker environment required|Local Docker endpoint required/
    );
  }
});
