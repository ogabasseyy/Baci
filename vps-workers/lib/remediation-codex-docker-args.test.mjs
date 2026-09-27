import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCodexDockerRuntimeArgs } from './remediation-codex-docker-args.mjs';

describe('Codex Docker runtime arguments', () => {
  it('combines runtime identity, capabilities, and protected mounts', () => {
    const args = buildCodexDockerRuntimeArgs({
      containerName: 'baci-remediation-test',
      readOnly: true,
      repoDir: '/repo',
      runtime: {
        capabilityArgs: ['--cap-add', 'DAC_READ_SEARCH'],
        identityArgs: ['--user', '0:0'],
        launchShell: '/usr/local/libexec/baci-real-dash',
      },
      worktreeDir: '/repo/worktree',
    });

    assert.equal(args.includes('--cap-drop'), true);
    assert.equal(args.includes('--entrypoint'), true);
    assert.equal(args.includes('/usr/local/libexec/baci-real-dash'), true);
    assert.equal(args.includes('DAC_READ_SEARCH'), true);
    assert.equal(args.includes('--user'), true);
    assert.equal(args.includes('0:0'), true);
    assert.equal(
      args.includes('type=bind,src=/repo/worktree,dst=/repo/worktree,readonly'),
      true
    );
    assert.equal(
      args.includes('type=bind,src=/repo/.git,dst=/repo/.git,readonly'),
      true
    );
  });
});
