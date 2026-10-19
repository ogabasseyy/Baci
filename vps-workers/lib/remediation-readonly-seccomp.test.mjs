import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readOnlyDockerSecurityArgs } from './remediation-readonly-seccomp.mjs';

describe('read-only Codex seccomp options', () => {
  it('uses the checked-in profile by default', () => {
    assert.deepEqual(readOnlyDockerSecurityArgs({}), [
      '--security-opt',
      `seccomp=${join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'config/codex-readonly-seccomp.json'
      )}`,
    ]);
  });

  it('keeps the nested sandbox exception limited to required syscalls', () => {
    const profilePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'config/codex-readonly-seccomp.json'
    );
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const rule = profile.syscalls.find((entry) =>
      entry.comment?.startsWith('Codex read-only research requires')
    );

    assert.deepEqual(rule?.names, [
      'clone',
      'clone3',
      'mount',
      'umount',
      'umount2',
      'unshare',
      'pivot_root',
    ]);
  });

  it('accepts an absolute regular profile override', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-seccomp-options-'));
    const profile = join(root, 'profile.json');
    writeFileSync(profile, '{}');
    try {
      assert.deepEqual(
        readOnlyDockerSecurityArgs({
          BACI_CODEX_READONLY_SECCOMP_PROFILE: profile,
        }),
        ['--security-opt', `seccomp=${profile}`]
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects relative and symlinked profile overrides', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-seccomp-invalid-'));
    const profile = join(root, 'profile.json');
    const link = join(root, 'profile-link.json');
    writeFileSync(profile, '{}');
    symlinkSync(profile, link);
    try {
      assert.throws(
        () =>
          readOnlyDockerSecurityArgs({
            BACI_CODEX_READONLY_SECCOMP_PROFILE: 'profile.json',
          }),
        /must be an absolute path/
      );
      assert.throws(
        () =>
          readOnlyDockerSecurityArgs({
            BACI_CODEX_READONLY_SECCOMP_PROFILE: link,
          }),
        /must reference a regular file/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
