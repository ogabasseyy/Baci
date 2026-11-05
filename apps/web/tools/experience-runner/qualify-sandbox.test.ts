import { describe, expect, it } from 'vitest';
import { probeSandbox } from './qualify-sandbox';

describe('qualification prerequisites', () => {
  it('reports missing runtime without starting a candidate', () => {
    expect(
      probeSandbox(() => ({ os: 'linux', runtimes: ['runc'] }), null)
    ).toMatchObject({
      status: 'BLOCKED',
      blockers: ['RUNSC_UNAVAILABLE', 'TOOLCHAIN_IMAGE_UNAVAILABLE'],
      authoredExecutionStarted: false,
    });
  });
  it('cannot report ready for a digest that is not installed', () => {
    expect(
      probeSandbox(
        () => ({ os: 'linux', runtimes: ['runsc'] }),
        `sha256:${'a'.repeat(64)}`
      ).status
    ).toBe('BLOCKED');
  });
  it('distinguishes unavailable Docker from an unqualified image', () => {
    expect(
      probeSandbox(() => {
        throw new Error('offline');
      }, null).blockers
    ).toContain('LINUX_REQUIRED');
    expect(
      probeSandbox(
        () => ({
          os: 'linux',
          runtimes: ['runsc'],
          images: [`sha256:${'a'.repeat(64)}`],
        }),
        `sha256:${'a'.repeat(64)}`
      ).status
    ).toBe('PREREQUISITES_READY');
  });
});
