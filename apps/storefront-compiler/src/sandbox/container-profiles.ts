/**
 * Host-specific isolation profiles for running @baci/storefront-compiler.
 *
 * Amendment 5 precision: Docker/runsc cgroup flags and Cloudflare Containers
 * instance types have distinct resource models. Gate 2 selects the production
 * host using PR 1's measured p95 compile latency and memory footprint.
 */

export type CloudflareContainerInstanceType =
  | 'lite'
  | 'basic'
  | 'standard-1'
  | 'standard-2';

export interface RunscDockerCompilerProfile {
  hostKind: 'runsc-docker';
  runtime: 'runsc';
  network: 'none';
  readOnlyRootfs: true;
  uid: 65532;
  gid: 65532;
  cpus: number;
  memoryMiB: number;
  memorySwapMiB: number;
  pidsLimit: number;
  tmpfsSizeMiB: number;
  sigkillTimeoutMs: number;
  dockerRunArgs: string[];
}

export interface CloudflareContainerCompilerProfile {
  hostKind: 'cloudflare-containers';
  instanceType: CloudflareContainerInstanceType;
  vcpu: number;
  memoryMiB: number;
  diskMiB: number;
  outboundInternetEnabled: false;
  sigkillTimeoutMs: number;
}

const INSTANCE_SPECS: Readonly<
  Record<
    CloudflareContainerInstanceType,
    { vcpu: number; memoryMiB: number; diskMiB: number }
  >
> = {
  lite: { vcpu: 0.0625, memoryMiB: 256, diskMiB: 2048 },
  basic: { vcpu: 0.25, memoryMiB: 1024, diskMiB: 4096 },
  'standard-1': { vcpu: 0.5, memoryMiB: 4096, diskMiB: 8192 },
  'standard-2': { vcpu: 1, memoryMiB: 6144, diskMiB: 12288 },
};

const DIGEST_IMAGE_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * Derives a deterministic hard SIGKILL wall-clock timeout from measured p95
 * compile time (`max(5 * p95, 5000ms)` safety headroom).
 */
export function deriveCompileSigkillTimeoutMs(measuredP95Ms: number): number {
  if (
    !Number.isFinite(measuredP95Ms) ||
    measuredP95Ms <= 0 ||
    measuredP95Ms > Number.MAX_SAFE_INTEGER / 5
  ) {
    throw new Error('measuredP95Ms must be a positive finite number');
  }
  const scaled = Math.ceil(measuredP95Ms * 5);
  return Math.max(scaled, 5000);
}

export function buildRunscDockerCompilerProfile(options: {
  imageDigest: string;
  measuredP95Ms: number;
  memoryMiB?: number;
  cpus?: number;
}): RunscDockerCompilerProfile {
  if (!DIGEST_IMAGE_PATTERN.test(options.imageDigest)) {
    throw new Error('Compiler container image must be pinned by sha256 digest');
  }
  const cpus = options.cpus ?? 1;
  const memoryMiB = options.memoryMiB ?? 512;
  const sigkillTimeoutMs = deriveCompileSigkillTimeoutMs(options.measuredP95Ms);
  return {
    hostKind: 'runsc-docker',
    runtime: 'runsc',
    network: 'none',
    readOnlyRootfs: true,
    uid: 65532,
    gid: 65532,
    cpus,
    memoryMiB,
    memorySwapMiB: memoryMiB,
    pidsLimit: 64,
    tmpfsSizeMiB: 64,
    sigkillTimeoutMs,
    dockerRunArgs: [
      'run',
      '--rm',
      '--runtime=runsc',
      '--network=none',
      '--read-only',
      '--user=65532:65532',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      `--cpus=${cpus}`,
      `--memory=${memoryMiB}m`,
      `--memory-swap=${memoryMiB}m`,
      '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m',
      '--interactive',
      options.imageDigest,
    ],
  };
}

export function buildCloudflareContainerCompilerProfile(options: {
  instanceType: CloudflareContainerInstanceType;
  measuredP95Ms: number;
}): CloudflareContainerCompilerProfile {
  const spec = INSTANCE_SPECS[options.instanceType];
  return {
    hostKind: 'cloudflare-containers',
    instanceType: options.instanceType,
    vcpu: spec.vcpu,
    memoryMiB: spec.memoryMiB,
    diskMiB: spec.diskMiB,
    outboundInternetEnabled: false,
    sigkillTimeoutMs: deriveCompileSigkillTimeoutMs(options.measuredP95Ms),
  };
}
