import { describe, expect, it } from 'vitest';
import { makeSandboxInvocation, sandboxPrerequisites } from './sandbox-policy';

describe('offline sandbox admission', () => {
  it('fails closed without runsc or a pinned toolchain image', () => {
    expect(
      sandboxPrerequisites({
        os: 'linux',
        runtimes: ['runc'],
        image: `sha256:${'a'.repeat(64)}`,
      })
    ).toEqual(['RUNSC_UNAVAILABLE']);
    expect(
      sandboxPrerequisites({ os: 'linux', runtimes: ['runsc'], image: null })
    ).toEqual(['TOOLCHAIN_IMAGE_UNAVAILABLE']);
    expect(
      sandboxPrerequisites({
        os: 'darwin',
        runtimes: ['runsc'],
        image: `sha256:${'a'.repeat(64)}`,
      })
    ).toContain('LINUX_REQUIRED');
  });
  it('does_not_inherit_parent_environment or mount host files and never weakens the runtime', () => {
    const invocation = makeSandboxInvocation(
      'build',
      `sha256:${'a'.repeat(64)}`
    );
    expect(invocation.args).toContain('--runtime=runsc');
    expect(invocation.args).toContain('--network=none');
    expect(invocation.args).toContain('--read-only');
    expect(invocation.args).toContain('--memory-swap=2g');
    expect(
      makeSandboxInvocation('capture', `sha256:${'a'.repeat(64)}`).args
    ).toContain('--memory-swap=3g');
    expect(invocation.args).not.toContain('--privileged');
    expect(
      invocation.args.some(
        (a) =>
          a.includes('mount') ||
          a.includes('volume') ||
          a.includes('docker.sock')
      )
    ).toBe(false);
    expect(invocation.env).toEqual({
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      TZ: 'UTC',
    });
    expect(invocation.timeoutMs).toBe(60000);
    expect(
      makeSandboxInvocation('capture', `sha256:${'a'.repeat(64)}`).timeoutMs
    ).toBe(30000);
    expect(() => makeSandboxInvocation('build', 'node:latest')).toThrow();
  });
});
