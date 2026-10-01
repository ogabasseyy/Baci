import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BUSY_EXIT_CODE = 75;
const DEFAULT_LOCK_PATH = 'locks/error-remediator-global.lock';
const capabilities = new WeakSet();

const sameFile = (left, right) =>
  left.dev === right.dev && left.ino === right.ino && left.isFile();

const deviceParts = (device) => {
  const value = BigInt(device);
  return {
    major: ((value >> 8n) & 0xfffn) | ((value >> 32n) & 0xfffff000n),
    minor: (value & 0xffn) | ((value >> 12n) & 0xffffff00n),
  };
};

const ownsLock = (lockPath) => {
  try {
    const before = lstatSync(lockPath);
    if (!before.isFile()) return false;
    const device = deviceParts(before.dev);
    const matchingLock = readFileSync('/proc/locks', 'utf8')
      .split('\n')
      .some((line) => {
        const fields = line.trim().split(/\s+/);
        const parts = fields[5]?.split(':');
        return (
          fields[1] === 'FLOCK' &&
          fields[3] === 'WRITE' &&
          fields[4] === String(process.pid) &&
          parts?.length === 3 &&
          BigInt(`0x${parts[0]}`) === device.major &&
          BigInt(`0x${parts[1]}`) === device.minor &&
          BigInt(parts[2]) === BigInt(before.ino)
        );
      });
    return matchingLock && sameFile(before, lstatSync(lockPath));
  } catch {
    return false;
  }
};

export const hasCurrentRemediationGlobalLock = (lockPath) => ownsLock(lockPath);

export const hasRemediationGlobalLockCapability = (value) =>
  typeof value === 'object' && value !== null && capabilities.has(value);

export function enterRemediationGlobalLock({
  argv = process.argv.slice(2),
  env = process.env,
  runner = spawnSync,
  scriptPath,
  waitSeconds,
} = {}) {
  if (!scriptPath) throw new Error('scriptPath is required');
  const lockPath = env.BACI_REMEDIATION_GLOBAL_LOCK_PATH
    ? resolve(env.BACI_REMEDIATION_GLOBAL_LOCK_PATH)
    : resolve(dirname(scriptPath), '..', DEFAULT_LOCK_PATH);
  if (ownsLock(lockPath)) {
    const capability = {};
    capabilities.add(capability);
    return { capability, exitCode: null };
  }
  const result = runner(
    'flock',
    [
      '-F',
      ...(waitSeconds === undefined ? ['-n'] : ['-w', String(waitSeconds)]),
      '-E',
      String(BUSY_EXIT_CODE),
      lockPath,
      process.execPath,
      scriptPath,
      ...argv,
    ],
    { env, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (!Number.isInteger(result.status)) {
    throw new Error('global remediation flock did not return an exit status');
  }
  return { capability: null, exitCode: result.status };
}

export async function runRemediationJobWithGlobalLock({ main, ...options }) {
  const entry = enterRemediationGlobalLock(options);
  if (!entry.capability) return entry.exitCode;
  await main(entry.capability);
  return null;
}
