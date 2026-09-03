import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runCodexShell } from './remediation-codex-shell-wrapper.mjs';

describe('Codex shell wrapper', () => {
  it('drops the research shell to the worker identity', () => {
    const calls = [];
    const identityCalls = [];
    const status = runCodexShell({
      args: ['-lc', 'printf restricted'],
      env: { BACI_CODEX_SHELL_GID: '1001', BACI_CODEX_SHELL_UID: '1001' },
      getgid: () => 0,
      getuid: () => 0,
      invokedPath: '/bin/sh',
      setgid: (gid) => identityCalls.push(['gid', gid]),
      setgroups: (groups) => identityCalls.push(['groups', groups]),
      setuid: (uid) => identityCalls.push(['uid', uid]),
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.deepEqual(identityCalls, [
      ['groups', []],
      ['gid', 1001],
      ['uid', 1001],
    ]);
    assert.equal(calls[0][0], '/bin/dash');
    assert.deepEqual(calls[0][1], ['-lc', 'printf restricted']);
  });

  it('preserves Bash syntax for Bash requests after dropping privileges', () => {
    const calls = [];
    const status = runCodexShell({
      args: ['-lc', '[[ -n "$BASH_VERSION" ]]'],
      env: { BACI_CODEX_SHELL_GID: '1001', BACI_CODEX_SHELL_UID: '1001' },
      getgid: () => 1001,
      getuid: () => 1001,
      invokedPath: '/bin/bash',
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(calls[0][0], '/usr/local/libexec/baci-real-bash');
  });

  it('preserves the restricted identity for /usr/bin/bash requests', () => {
    const calls = [];
    const status = runCodexShell({
      args: ['-lc', 'printf "%s" "$(id -u)"'],
      env: { BACI_CODEX_SHELL_GID: '1001', BACI_CODEX_SHELL_UID: '1001' },
      getgid: () => 0,
      getuid: () => 0,
      invokedPath: '/usr/bin/bash',
      setgid: () => 0,
      setgroups: () => undefined,
      setuid: () => 0,
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(calls[0][0], '/usr/local/libexec/baci-real-bash');
  });

  it('routes /usr/bin/sh requests through the restricted dash', () => {
    const calls = [];
    const status = runCodexShell({
      args: ['-lc', 'printf restricted'],
      env: { BACI_CODEX_SHELL_GID: '1001', BACI_CODEX_SHELL_UID: '1001' },
      getgid: () => 1001,
      getuid: () => 1001,
      invokedPath: '/usr/bin/sh',
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(calls[0][0], '/bin/dash');
  });

  it('drops privileges for the alternate copied dash path', () => {
    const calls = [];
    const identityCalls = [];
    const status = runCodexShell({
      args: ['-lc', 'printf restricted'],
      env: {
        BACI_CODEX_SHELL_BOOTSTRAP: '1',
        BACI_CODEX_SHELL_GID: '1001',
        BACI_CODEX_SHELL_UID: '1001',
      },
      getgid: () => 0,
      getuid: () => 0,
      invokedPath: '/usr/local/libexec/baci-real-dash',
      pid: 42,
      setgid: (gid) => identityCalls.push(['gid', gid]),
      setgroups: (groups) => identityCalls.push(['groups', groups]),
      setuid: (uid) => identityCalls.push(['uid', uid]),
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.deepEqual(identityCalls, [
      ['groups', []],
      ['gid', 1001],
      ['uid', 1001],
    ]);
    assert.equal(calls[0][0], '/bin/dash');
  });

  it('keeps root only for the PID 1 bootstrap invocation', () => {
    const calls = [];
    const identityCalls = [];
    const status = runCodexShell({
      args: ['-lc', 'exec /opt/codex/bin/codex'],
      env: {
        BACI_CODEX_SHELL_BOOTSTRAP: '1',
        BACI_CODEX_SHELL_GID: '1001',
        BACI_CODEX_SHELL_UID: '1001',
      },
      getgid: () => 0,
      getuid: () => 0,
      invokedPath: '/usr/local/libexec/baci-real-dash',
      pid: 1,
      setgid: (gid) => identityCalls.push(['gid', gid]),
      setgroups: (groups) => identityCalls.push(['groups', groups]),
      setuid: (uid) => identityCalls.push(['uid', uid]),
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.deepEqual(identityCalls, []);
    assert.equal(calls[0][0], '/bin/dash');
  });

  it('refuses to run when no restricted identity is supplied', () => {
    const calls = [];
    const status = runCodexShell({
      args: ['-lc', 'printf normal'],
      env: {},
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 126);
    assert.equal(calls.length, 0);
  });
});
