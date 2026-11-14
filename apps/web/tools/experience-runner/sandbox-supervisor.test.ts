import { describe, expect, it, vi } from 'vitest';
import { runIsolatedJob, type SandboxInvocation } from './sandbox-supervisor';

const image = `sha256:${'a'.repeat(64)}`;
describe('trusted sandbox supervisor', () => {
  it('refuses execution without runsc and keeps the output ticket outside the child', async () => {
    const execute = vi.fn();
    await expect(
      runIsolatedJob(
        { kind: 'probe', payload: { test: 'network' } },
        { image, host: { os: 'linux', runtimes: ['runc'] }, execute }
      )
    ).rejects.toThrow('RUNSC_UNAVAILABLE');
    expect(execute).not.toHaveBeenCalled();
  });
  it('bounds output, uses a generated disposable name, and does not forward parent secrets', async () => {
    const execute = vi.fn(async (_invocation: SandboxInvocation) => ({
      code: 0,
      stdout: '{"ok":true}',
      wallMs: 1,
    }));
    expect(
      await runIsolatedJob(
        { kind: 'probe', payload: { test: 'files' } },
        { image, host: { os: 'linux', runtimes: ['runsc'] }, execute }
      )
    ).toMatchObject({ result: { ok: true } });
    const invocation = execute.mock.calls[0][0];
    expect(invocation.args).toContain('--network=none');
    expect(invocation.name).toMatch(/^baci-experience-/);
    expect(invocation.input).toBe(
      '{"kind":"probe","payload":{"test":"files"}}'
    );
    expect(Object.keys(invocation.env)).toEqual(['PATH', 'LANG', 'TZ']);
    await expect(
      runIsolatedJob(
        { kind: 'probe', payload: {} },
        {
          image,
          host: { os: 'linux', runtimes: ['runsc'] },
          execute: async () => ({
            code: 0,
            stdout: 'x'.repeat(16 * 1024 * 1024 + 1),
            wallMs: 1,
          }),
        }
      )
    ).rejects.toThrow('Output budget');
  });
  it('does not turn failed or malformed worker output into accepted evidence', async () => {
    for (const result of [
      { code: 1, stdout: '{"ok":true}', wallMs: 1 },
      { code: 0, stdout: 'not json', wallMs: 1 },
    ]) {
      await expect(
        runIsolatedJob(
          { kind: 'probe', payload: {} },
          {
            image,
            host: { os: 'linux', runtimes: ['runsc'] },
            execute: async () => result,
          }
        )
      ).rejects.toThrow();
    }
  });
});
