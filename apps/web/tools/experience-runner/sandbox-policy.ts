export interface SandboxPrerequisites {
  os: string;
  runtimes: string[];
  image: string | null;
}
const digestImage = /^sha256:[a-f0-9]{64}$/;
/** Admission only; portable tests of these flags do not prove OS containment. */
export function sandboxPrerequisites(input: SandboxPrerequisites): string[] {
  return [
    ...(input.os !== 'linux' ? ['LINUX_REQUIRED'] : []),
    ...(!input.runtimes.includes('runsc') ? ['RUNSC_UNAVAILABLE'] : []),
    ...(!input.image || !digestImage.test(input.image)
      ? ['TOOLCHAIN_IMAGE_UNAVAILABLE']
      : []),
  ];
}
export function makeSandboxInvocation(
  kind: 'build' | 'capture',
  image: string
) {
  if (!digestImage.test(image)) throw new Error('Pinned image digest required');
  const capture = kind === 'capture';
  return {
    args: [
      'run',
      '--rm',
      '--runtime=runsc',
      '--network=none',
      '--read-only',
      '--user=65532:65532',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      `--cpus=${capture ? 2 : 1}`,
      `--memory=${capture ? '3g' : '2g'}`,
      `--memory-swap=${capture ? '3g' : '2g'}`,
      '--tmpfs=/tmp:rw,nosuid,nodev,size=64m',
      '--tmpfs=/dev/shm:rw,nosuid,nodev,size=64m',
      '--interactive',
      image,
      'node',
      '/opt/experience/job.mjs',
      kind,
    ],
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC' },
    timeoutMs: capture ? 30000 : 60000,
    maxOutputBytes: 16 * 1024 * 1024,
  };
}
