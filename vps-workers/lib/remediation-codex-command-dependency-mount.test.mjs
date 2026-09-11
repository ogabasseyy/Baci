import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildRemediationCodexCommand } from './remediation-codex-command.mjs';

const testContainerIdentity = { gid: 1001, uid: 1001 };

function dockerEnvironment(dependencyRoot) {
  return {
    BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
    BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
    BACI_REMEDIATION_DEPENDENCY_ROOT: dependencyRoot,
    CODEX_HOME: '/home/worker/.codex',
    HOME: '/home/worker',
  };
}

describe('remediation Codex dependency mounts', () => {
  it('creates dependency mount points before mounting a read-only worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-dependency-mount-'));
    const dependencyRoot = join(root, 'dependencies');
    const worktreeDir = join(root, 'worktree');
    try {
      mkdirSync(join(dependencyRoot, 'node_modules'), { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });

      const result = buildRemediationCodexCommand({
        codexBin: '/opt/host/codex',
        containerIdentity: testContainerIdentity,
        env: dockerEnvironment(dependencyRoot),
        prompt: 'Research safely.',
        readOnly: true,
        repoDir: worktreeDir,
        worktreeDir,
      });

      const destination = join(worktreeDir, 'node_modules');
      assert.equal(existsSync(destination), true);
      assert.equal(lstatSync(destination).isDirectory(), true);
      assert.equal(
        result.args.includes(
          `type=bind,src=${join(dependencyRoot, 'node_modules')},dst=${destination},readonly`
        ),
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a dependency mount point symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-dependency-symlink-'));
    const dependencyRoot = join(root, 'dependencies');
    const worktreeDir = join(root, 'worktree');
    try {
      mkdirSync(join(dependencyRoot, 'node_modules'), { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });
      symlinkSync(root, join(worktreeDir, 'node_modules'));

      assert.throws(
        () =>
          buildRemediationCodexCommand({
            codexBin: '/opt/host/codex',
            containerIdentity: testContainerIdentity,
            env: dockerEnvironment(dependencyRoot),
            prompt: 'Research safely.',
            readOnly: true,
            repoDir: worktreeDir,
            worktreeDir,
          }),
        /dependency mount path must be a real directory/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked ancestor before creating dependency mount points', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-dependency-ancestor-'));
    const dependencyRoot = join(root, 'dependencies');
    const externalApps = join(root, 'external-apps');
    const worktreeDir = join(root, 'worktree');
    try {
      mkdirSync(join(dependencyRoot, 'apps/web/node_modules'), {
        recursive: true,
      });
      mkdirSync(externalApps, { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });
      symlinkSync(externalApps, join(worktreeDir, 'apps'));

      assert.throws(
        () =>
          buildRemediationCodexCommand({
            codexBin: '/opt/host/codex',
            containerIdentity: testContainerIdentity,
            env: dockerEnvironment(dependencyRoot),
            prompt: 'Research safely.',
            readOnly: true,
            repoDir: worktreeDir,
            worktreeDir,
          }),
        /dependency mount path must be a real directory/
      );
      assert.equal(existsSync(join(externalApps, 'web')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
