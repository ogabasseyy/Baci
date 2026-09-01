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
      ['--mount', '--mount', '--mount', '--mount', '--mount']
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
});
