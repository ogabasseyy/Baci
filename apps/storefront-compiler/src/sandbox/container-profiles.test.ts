import { describe, expect, it } from 'vitest';
import {
  buildCloudflareContainerCompilerProfile,
  buildRunscDockerCompilerProfile,
  deriveCompileSigkillTimeoutMs,
} from './container-profiles';

describe('container-profiles', () => {
  it('derives 5x p95 SIGKILL timeout with a 5000ms floor and rejects non-positive/infinite inputs', () => {
    expect(deriveCompileSigkillTimeoutMs(400)).toBe(5000);
    expect(deriveCompileSigkillTimeoutMs(1500)).toBe(7500);
    expect(() => deriveCompileSigkillTimeoutMs(0)).toThrow();
    expect(() => deriveCompileSigkillTimeoutMs(-10)).toThrow();
    expect(() => deriveCompileSigkillTimeoutMs(Number.NaN)).toThrow();
  });

  it('builds isolated runsc Docker and Cloudflare Containers profiles with internet disabled', () => {
    const digest = `sha256:${'b'.repeat(64)}`;
    const runsc = buildRunscDockerCompilerProfile({
      imageDigest: digest,
      measuredP95Ms: 1200,
    });
    expect(runsc.network).toBe('none');
    expect(runsc.readOnlyRootfs).toBe(true);
    expect(runsc.sigkillTimeoutMs).toBe(6000);
    expect(runsc.dockerRunArgs).toContain('--network=none');

    expect(() =>
      buildRunscDockerCompilerProfile({
        imageDigest: 'node:24-slim',
        measuredP95Ms: 500,
      })
    ).toThrow(/sha256 digest/);

    const cf = buildCloudflareContainerCompilerProfile({
      instanceType: 'basic',
      measuredP95Ms: 900,
    });
    expect(cf.outboundInternetEnabled).toBe(false);
    expect(cf.memoryMiB).toBe(1024);
    expect(cf.sigkillTimeoutMs).toBe(5000);
  });
});
