/** Direct runsc profile for local qualification, independent of shared Docker GC. */
export function makeOCISpec(
  rootPath: string,
  args: string[],
  kind: 'build' | 'capture'
) {
  if (
    !/^\/var\/tmp\/baci-experience-checkpoint-a\/[a-z0-9-]+\/rootfs$/.test(
      rootPath
    )
  )
    throw new Error('Untrusted rootfs');
  if (args[0] !== '/usr/local/bin/node' || args.length > 6)
    throw new Error('Fixed Node entry required');
  const memory = (kind === 'capture' ? 3 : 2) * 1024 * 1024 * 1024;
  return {
    ociVersion: '1.2.0',
    root: { path: rootPath, readonly: true },
    hostname: 'baci-experience-qualification',
    process: {
      terminal: false,
      user: { uid: 65532, gid: 65532 },
      args,
      env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC'],
      cwd: '/',
      noNewPrivileges: true,
      capabilities: {
        bounding: [],
        effective: [],
        inheritable: [],
        permitted: [],
        ambient: [],
      },
      rlimits: [{ type: 'RLIMIT_NOFILE', hard: 1024, soft: 1024 }],
    },
    mounts: [
      {
        destination: '/proc',
        type: 'proc',
        source: 'proc',
        options: ['nosuid', 'noexec', 'nodev'],
      },
      {
        destination: '/dev',
        type: 'tmpfs',
        source: 'tmpfs',
        options: ['nosuid', 'strictatime', 'mode=755', 'size=65536k'],
      },
      {
        destination: '/dev/shm',
        type: 'tmpfs',
        source: 'shm',
        options: ['nosuid', 'noexec', 'nodev', 'mode=1777', 'size=65536k'],
      },
      {
        destination: '/tmp',
        type: 'tmpfs',
        source: 'tmpfs',
        options: ['nosuid', 'nodev', 'mode=1777', 'size=65536k'],
      },
    ],
    linux: {
      namespaces: [
        { type: 'pid' },
        { type: 'network' },
        { type: 'ipc' },
        { type: 'uts' },
        { type: 'mount' },
      ],
      resources: {
        memory: { limit: memory, swap: memory },
        cpu: { period: 100000, quota: kind === 'capture' ? 200000 : 100000 },
        // Capture includes browser/driver and trusted gVisor helper threads.
        pids: { limit: kind === 'capture' ? 256 : 128 },
      },
      maskedPaths: ['/proc/kcore', '/proc/keys', '/proc/timer_list'],
      readonlyPaths: ['/proc/sys', '/proc/sysrq-trigger'],
    },
  };
}
