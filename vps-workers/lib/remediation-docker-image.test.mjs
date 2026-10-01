import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDockerImageUnavailable } from './remediation-docker-image-availability.mjs';
import { assertConfiguredDockerImageAvailable } from './remediation-docker-image-preflight.mjs';

describe('remediation Docker image guard', () => {
  it('checks the configured image without invoking a shell', () => {
    const calls = [];
    assertConfiguredDockerImageAvailable({
      env: {
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:sha',
        DOCKER_BIN: 'docker',
      },
      options: { env: { DOCKER_BIN: 'docker' }, cwd: '/repo' },
      runner(command, args, options) {
        calls.push({ args, command, options });
        return { status: 0, stderr: '', stdout: '' };
      },
    });

    assert.deepEqual(calls, [
      {
        args: ['image', 'inspect', '--', 'baci-codex-remediator:sha'],
        command: 'docker',
        options: {
          cwd: '/repo',
          env: { DOCKER_BIN: 'docker' },
          shell: false,
          timeout: 30_000,
        },
      },
    ]);
  });

  it('bounds image inspection when no timeout is supplied', () => {
    const calls = [];
    assertConfiguredDockerImageAvailable({
      env: { BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:sha' },
      options: { env: {}, cwd: '/repo' },
      runner(command, args, options) {
        calls.push({ args, command, options });
        return { status: 0, stderr: '', stdout: '' };
      },
    });

    assert.equal(calls[0].options.timeout, 30_000);
  });

  it('blocks before worktree creation when the configured image is missing', () => {
    assert.throws(
      () =>
        assertConfiguredDockerImageAvailable({
          env: { BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:sha' },
          options: { env: {} },
          runner: () => ({
            status: 1,
            stderr: 'pull access denied',
            stdout: '',
          }),
        }),
      /configured BACI_CODEX_DOCKER_IMAGE is unavailable/
    );
  });

  it('uses the configured Docker binary during image preflight', () => {
    const calls = [];
    assertConfiguredDockerImageAvailable({
      env: {
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:sha',
        DOCKER_BIN: '/opt/bin/docker-wrapper',
      },
      options: { env: {} },
      runner(command, args) {
        calls.push({ args, command });
        return { status: 0, stderr: '', stdout: '' };
      },
    });

    assert.equal(calls[0].command, '/opt/bin/docker-wrapper');
  });

  it('recognizes Docker image launch failures for cleanup', () => {
    assert.equal(
      isDockerImageUnavailable(
        new Error('Unable to find image baci-codex-remediator:sha locally'),
        { args: ['run', 'baci-codex-remediator:sha'], command: 'docker' }
      ),
      true
    );
    assert.equal(
      isDockerImageUnavailable(new Error('Codex timed out'), {
        args: ['run', 'baci-codex-remediator:sha'],
        command: 'docker',
      }),
      false
    );
  });

  it('ignores repository output that only mentions a missing image asset', () => {
    assert.equal(
      isDockerImageUnavailable(
        new Error('test failed: image asset not found'),
        {
          args: ['run', 'baci-codex-remediator:sha'],
          command: 'docker',
        }
      ),
      false
    );
    assert.equal(
      isDockerImageUnavailable(
        new Error('Unable to find image baci-codex-remediator:sha locally'),
        { args: ['exec', 'baci-codex-remediator:sha'], command: 'docker' }
      ),
      false
    );
  });
});
