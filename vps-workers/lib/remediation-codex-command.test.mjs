import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildRemediationCodexCommand } from './remediation-codex-command.mjs';

describe('remediation Codex command', () => {
  it('uses the native workspace sandbox by default', () => {
    const result = buildRemediationCodexCommand({
      codexBin: 'codex',
      env: { HOME: '/home/worker' },
      prompt: 'Investigate safely.',
      repoDir: '/repo',
      worktreeDir: '/worktree',
    });

    assert.equal(result.command, 'codex');
    assert.deepEqual(result.args.slice(0, 2), ['--search', 'exec']);
    assert.equal(result.args.includes('--search'), true);
    assert.equal(result.args.includes('use_legacy_landlock'), false);
    assert.equal(result.args.includes('workspace-write'), true);
    assert.equal(result.args.includes('--json'), true);
  });

  it('enables search for a native read-only research command', () => {
    const result = buildRemediationCodexCommand({
      codexBin: 'codex',
      env: { HOME: '/home/worker' },
      prompt: 'Return a canary response only.',
      readOnly: true,
      repoDir: '/repo',
      worktreeDir: '/repo',
    });

    assert.equal(result.args.includes('--search'), true);
    assert.equal(result.args.includes('--sandbox'), true);
    assert.equal(result.args.includes('read-only'), true);
  });

  it('allows the read-only canary to disable web search explicitly', () => {
    const result = buildRemediationCodexCommand({
      codexBin: 'codex',
      enableSearch: false,
      env: { HOME: '/home/worker' },
      prompt: 'Return a canary response only.',
      readOnly: true,
      repoDir: '/repo',
      worktreeDir: '/repo',
    });

    assert.equal(result.args.includes('--search'), false);
  });

  it('isolates VPS Codex inside a capability-free Docker container', () => {
    const result = buildRemediationCodexCommand({
      codexBin: '/opt/host/codex',
      env: {
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        CODEX_HOME: '/home/worker/.codex',
        HOME: '/home/worker',
      },
      prompt: 'Investigate safely.',
      repoDir: '/repo',
      worktreeDir: '/worktree',
    });

    assert.equal(result.command, 'docker');
    assert.deepEqual(result.cleanup, {
      args: ['rm', '-f', 'baci-remediation-worktree'],
      command: 'docker',
    });
    assert.deepEqual(result.args.slice(0, 5), [
      'run',
      '--rm',
      '--name',
      'baci-remediation-worktree',
      '--cap-drop',
    ]);
    assert.equal(result.args.includes('ALL'), true);
    assert.equal(result.args.includes('no-new-privileges'), true);
    assert.equal(result.args.includes('1'), true);
    assert.equal(result.args.filter((value) => value === '2g').length, 2);
    assert.equal(
      result.args.includes('--dangerously-bypass-approvals-and-sandbox'),
      true
    );
    assert.equal(result.args.includes('--enable'), true);
    assert.equal(result.args.includes('use_legacy_landlock'), true);
    assert.equal(result.args.includes('--search'), true);
    assert.equal(result.args.includes('--ignore-user-config'), true);
    assert.equal(
      result.args.includes('type=bind,src=/worktree,dst=/worktree'),
      true
    );
    assert.equal(
      result.args.includes(
        'type=bind,src=/home/worker/.codex/auth.json,dst=/codex-auth/auth.json,readonly'
      ),
      true
    );
    assert.equal(result.args.includes('CODEX_HOME=/codex-home'), true);
    assert.equal(
      result.args.includes('--tmpfs') &&
        result.args.includes(
          `/codex-home:rw,nosuid,nodev,size=64m,uid=${process.getuid()},gid=${process.getgid()},mode=700`
        ),
      true
    );
    assert.equal(result.args.includes('--json'), true);
    assert.equal(
      result.args.includes('type=bind,src=/repo/.git,dst=/repo/.git,readonly'),
      true
    );
    assert.equal(
      result.args.includes(
        'type=bind,src=/opt/host/codex-native,dst=/opt/codex/bin/codex,readonly'
      ),
      true
    );
  });

  it('builds a read-only Docker canary command from the remediation builder', () => {
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
    assert.equal(result.args.includes('--search'), false);
    assert.equal(result.args.includes('--sandbox'), false);
    assert.equal(
      result.args.includes('--dangerously-bypass-approvals-and-sandbox'),
      true
    );
    assert.equal(result.args.includes('workspace-write'), false);
    assert.equal(result.args.includes('use_legacy_landlock'), false);
    assert.equal(
      result.args.includes('type=bind,src=/repo,dst=/repo,readonly'),
      true
    );
    assert.equal(
      result.args.includes(
        'type=bind,src=/home/worker/.codex/auth.json,dst=/codex-auth/auth.json,readonly'
      ),
      true
    );
  });

  it('uses the configured seccomp profile only for read-only Docker commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-codex-seccomp-'));
    const profile = join(root, 'profile.json');
    writeFileSync(profile, '{}');
    try {
      const result = buildRemediationCodexCommand({
        codexBin: '/opt/host/codex',
        env: {
          BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
          BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
          BACI_CODEX_READONLY_SECCOMP_PROFILE: profile,
          CODEX_HOME: '/home/worker/.codex',
          HOME: '/home/worker',
        },
        prompt: 'Inspect safely.',
        readOnly: true,
        repoDir: '/repo',
        worktreeDir: '/repo',
      });

      assert.equal(result.args.includes(`seccomp=${profile}`), true);

      const writeResult = buildRemediationCodexCommand({
        codexBin: '/opt/host/codex',
        env: {
          BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
          BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
          BACI_CODEX_READONLY_SECCOMP_PROFILE: profile,
          CODEX_HOME: '/home/worker/.codex',
          HOME: '/home/worker',
        },
        prompt: 'Implement safely.',
        repoDir: '/repo',
        worktreeDir: '/worktree',
      });

      assert.equal(writeResult.args.includes(`seccomp=${profile}`), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mounts native Codex resources when the pinned binary has siblings', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-codex-resources-'));
    const vendor = join(root, 'vendor');
    const binary = join(vendor, 'bin', 'codex');
    const resources = join(vendor, 'codex-resources');
    try {
      mkdirSync(join(resources, 'zsh', 'bin'), { recursive: true });
      const result = buildRemediationCodexCommand({
        codexBin: '/opt/host/codex',
        env: {
          BACI_CODEX_CONTAINER_BIN: binary,
          BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
          CODEX_HOME: '/home/worker/.codex',
          HOME: '/home/worker',
        },
        prompt: 'Return a canary response only.',
        readOnly: true,
        repoDir: '/repo',
        worktreeDir: '/repo',
      });

      assert.equal(
        result.args.includes(
          `type=bind,src=${resources},dst=/opt/codex/codex-resources,readonly`
        ),
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses an unprivileged fallback identity when POSIX IDs are unavailable', () => {
    const getuid = process.getuid;
    const getgid = process.getgid;
    try {
      process.getuid = undefined;
      process.getgid = undefined;
      const result = buildRemediationCodexCommand({
        codexBin: '/opt/host/codex',
        env: {
          BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
          BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
          CODEX_HOME: '/home/worker/.codex',
          HOME: '/home/worker',
        },
        prompt: 'Inspect safely.',
        repoDir: '/repo',
        worktreeDir: '/worktree',
      });

      assert.equal(result.args.includes('1000:1000'), true);
      assert.equal(
        result.args.includes(
          '/codex-home:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700'
        ),
        true
      );
    } finally {
      process.getuid = getuid;
      process.getgid = getgid;
    }
  });

  it('fails closed without an explicit native Codex binary', () => {
    assert.throws(
      () =>
        buildRemediationCodexCommand({
          codexBin: '/opt/host/codex',
          env: {
            BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
            HOME: '/home/worker',
          },
          prompt: 'Investigate safely.',
          repoDir: '/repo',
          worktreeDir: '/worktree',
        }),
      /BACI_CODEX_CONTAINER_BIN is required/
    );
  });
});
