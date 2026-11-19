import { describe, expect, it } from 'vitest';
import { makeOCISpec } from './oci-policy';

describe('dedicated runsc OCI policy', () => {
  it('uses only immutable rootfs and synthetic scratch with no host binds or credentials', () => {
    const spec = makeOCISpec(
      '/var/tmp/baci-experience-checkpoint-a/node24/rootfs',
      ['/usr/local/bin/node', '/opt/experience/job.mjs'],
      'build'
    );
    expect(spec.root.readonly).toBe(true);
    expect(spec.process.user.uid).toBe(65532);
    expect(spec.process.noNewPrivileges).toBe(true);
    expect(spec.mounts.some((m) => m.type === 'bind')).toBe(false);
    expect(spec.process.env).toEqual([
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C.UTF-8',
      'TZ=UTC',
    ]);
    expect(spec.linux.resources.memory.limit).toBe(2147483648);
    expect(spec.linux.resources.pids.limit).toBe(128);
    expect(() => makeOCISpec('/Users/mac', ['/bin/sh'], 'build')).toThrow();
  });
});

it('reserves a bounded capture task allowance for browser and trusted gVisor threads', () => {
  const spec = makeOCISpec(
    '/var/tmp/baci-experience-checkpoint-a/browser/rootfs',
    ['/usr/local/bin/node', '/opt/experience/capture-worker.mjs'],
    'capture'
  );
  expect(spec.linux.resources.pids.limit).toBe(256);
  expect(spec.linux.resources.cpu).toEqual({ period: 100000, quota: 200000 });
  expect(spec.linux.resources.memory).toEqual({
    limit: 3221225472,
    swap: 3221225472,
  });
  expect(spec.process.user.uid).toBe(65532);
  expect(spec.root.readonly).toBe(true);
  expect(spec.linux.namespaces).toContainEqual({ type: 'network' });
});
