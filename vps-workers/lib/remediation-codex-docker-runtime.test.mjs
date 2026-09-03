import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCodexDockerRuntime } from './remediation-codex-docker-runtime.mjs';

describe('buildCodexDockerRuntime', () => {
  it('builds a root-only read-only runtime with isolated auth and shells', () => {
    const runtime = buildCodexDockerRuntime({
      codexHome: '/home/worker/.codex',
      gid: 1001,
      readOnly: true,
      uid: 1001,
    });

    assert.deepEqual(runtime.identityArgs, [
      '--tmpfs',
      '/codex-home:rw,nosuid,nodev,size=64m,uid=0,gid=0,mode=700',
      '--user',
      '0:0',
    ]);
    assert.deepEqual(runtime.capabilityArgs, [
      '--cap-add',
      'DAC_OVERRIDE',
      '--cap-add',
      'DAC_READ_SEARCH',
      '--cap-add',
      'SETUID',
      '--cap-add',
      'SETGID',
    ]);
    assert.equal(runtime.launchShell, '/usr/local/libexec/baci-real-dash');
    assert.match(runtime.launchScript, /source-auth\.json/);
    assert.match(runtime.launchScript, /chmod 400/);
    assert.deepEqual(
      runtime.authArgs.filter((value) => value.startsWith('--mount')),
      Array.from({ length: 11 }, () => '--mount')
    );
    assert.ok(
      runtime.authArgs.some((value) =>
        value.includes('dst=/codex-auth/source-auth.json,readonly')
      )
    );
    assert.ok(
      runtime.authArgs.some((value) => value.includes('dst=/bin/bash,readonly'))
    );
    assert.ok(
      runtime.authArgs.some((value) =>
        value.includes('dst=/usr/bin/bash,readonly')
      )
    );
    assert.ok(
      runtime.authArgs.some((value) => value.includes('dst=/bin/sh,readonly'))
    );
    assert.ok(
      runtime.authArgs.some((value) =>
        value.includes('dst=/usr/bin/sh,readonly')
      )
    );
    for (const shellPath of [
      '/bin/dash',
      '/usr/bin/dash',
      '/usr/local/libexec/baci-real-bash',
      '/usr/local/libexec/baci-real-dash',
      '/usr/local/libexec/baci-shell-bash',
      '/usr/local/libexec/baci-shell-dash',
    ]) {
      assert.ok(
        runtime.authArgs.some((value) =>
          value.includes(`dst=${shellPath},readonly`)
        )
      );
    }
    assert.ok(runtime.authArgs.includes('BACI_CODEX_SHELL_BOOTSTRAP=1'));
    assert.match(runtime.launchScript, /unset BACI_CODEX_SHELL_BOOTSTRAP/);
  });

  it('builds a writable runtime with the supplied worker identity', () => {
    const runtime = buildCodexDockerRuntime({
      codexHome: '/srv/codex',
      gid: 2002,
      readOnly: false,
      uid: 2001,
    });

    assert.deepEqual(runtime.identityArgs, [
      '--tmpfs',
      '/codex-home:rw,nosuid,nodev,size=64m,uid=2001,gid=2002,mode=700',
      '--user',
      '2001:2002',
    ]);
    assert.deepEqual(runtime.capabilityArgs, []);
    assert.equal(runtime.launchShell, '/usr/local/libexec/baci-real-dash');
    assert.match(runtime.launchScript, /auth\.json/);
    assert.match(runtime.launchScript, /chmod 600/);
    assert.ok(runtime.authArgs.includes('--mount'));
    assert.ok(
      runtime.authArgs.some((value) =>
        value.includes('dst=/codex-auth/auth.json,readonly')
      )
    );
    assert.ok(!runtime.authArgs.some((value) => value.includes('/bin/bash')));
  });

  it('rejects a root worker identity for read-only research', () => {
    assert.throws(
      () =>
        buildCodexDockerRuntime({
          codexHome: '/home/root/.codex',
          gid: 0,
          readOnly: true,
          uid: 0,
        }),
      /requires a non-root worker identity/
    );
  });
});
