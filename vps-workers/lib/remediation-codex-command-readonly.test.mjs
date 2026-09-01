import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRemediationCodexCommand } from './remediation-codex-command.mjs';

describe('read-only Docker Codex command', () => {
  it('keeps credentials inaccessible to generated research shells', () => {
    const result = buildRemediationCodexCommand({
      codexBin: '/opt/host/codex',
      env: {
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        CODEX_HOME: '/home/worker/.codex',
        HOME: '/home/worker',
      },
      enableSearch: false,
      prompt: 'Return a canary response only.',
      readOnly: true,
      repoDir: '/repo',
      worktreeDir: '/repo',
    });

    assert.equal(result.args.includes('--read-only'), true);
    assert.equal(result.args.includes('--user'), true);
    assert.equal(result.args.includes('0:0'), true);
    for (const capability of [
      'DAC_OVERRIDE',
      'DAC_READ_SEARCH',
      'SETUID',
      'SETGID',
    ]) {
      assert.equal(result.args.includes(capability), true);
    }
    assert.equal(
      result.args.includes('/codex-auth:rw,nosuid,nodev,size=1m,mode=700'),
      true
    );
    assert.equal(result.args.includes('--search'), false);
    assert.equal(result.args.includes('--sandbox'), true);
    assert.equal(result.args.includes('read-only'), true);
    assert.equal(
      result.args.includes('--dangerously-bypass-approvals-and-sandbox'),
      false
    );
    assert.equal(result.args.includes('use_legacy_landlock'), true);
    assert.equal(result.args.includes('workspace-write'), false);
    assert.equal(
      result.args.some((value) => value.endsWith('dst=/bin/bash,readonly')),
      true
    );
    assert.equal(
      result.args.some((value) => value.endsWith('dst=/usr/bin/bash,readonly')),
      true
    );
    assert.equal(
      result.args.some((value) => value.endsWith('dst=/bin/sh,readonly')),
      true
    );
    assert.equal(
      result.args.includes('/usr/local/libexec/baci-real-dash'),
      true
    );
    assert.equal(
      result.args.includes('type=bind,src=/repo,dst=/repo,readonly'),
      true
    );
    assert.equal(
      result.args.includes(
        'type=bind,src=/home/worker/.codex/auth.json,dst=/codex-auth/source-auth.json,readonly'
      ),
      true
    );
    assert.equal(
      result.args.includes(`BACI_CODEX_SHELL_UID=${process.getuid()}`),
      true
    );
    assert.equal(
      result.args.includes(`BACI_CODEX_SHELL_GID=${process.getgid()}`),
      true
    );
    const launchScript = result.args.find((value) =>
      value.includes('chmod 700 /codex-auth')
    );
    assert.match(launchScript, /chmod 700 \/codex-auth/);
    assert.match(launchScript, /chmod 400 "\$CODEX_HOME\/auth\.json"/);
  });
});
