import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runHelperQualification } from './helper-executor';
import {
  type LocalTransport,
  outputBudgetExceeded,
  PREPARE,
  REMOVE_BUNDLE,
  ROOT,
  runLocalQualification,
} from './local-oci-executor';
import { createRunnerHandler } from './runner-transport';

const exec = promisify(execFile);
export type LinuxRunnerCommand = (
  program: string,
  args: string[],
  input: string | undefined,
  timeoutMs: number
) => Promise<string>;
export const runCommand: LinuxRunnerCommand = async (
  program,
  args,
  input,
  timeoutMs
) => {
  const child = exec(program, args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
  const exceeds = outputBudgetExceeded();
  let overflow = false;
  const account = (chunk: Buffer | string) => {
    if (exceeds(chunk)) {
      overflow = true;
      child.child.stdout?.destroy();
      child.child.stderr?.destroy();
      child.child.kill('SIGKILL');
    }
  };
  child.child.stdout?.on('data', account);
  child.child.stderr?.on('data', account);
  child.child.stdin?.on('error', () => undefined);
  child.child.stdin?.end(input);
  try {
    const result = await child;
    if (overflow) throw Error('RUNNER_OUTPUT_BUDGET');
    return result.stdout;
  } catch {
    throw Error(overflow ? 'RUNNER_OUTPUT_BUDGET' : 'RUNNER_EXECUTION_FAILED');
  }
};

/** Reuse the exact reviewed OCI spec, fixed programs, budgets and cleanup. Only
 * replace Colima's trusted SSH hop with a direct Linux command; no shell or
 * caller-selected executable, image, mount or environment is introduced. */
export function createDirectOCITransport(
  command: LinuxRunnerCommand = runCommand
): LocalTransport {
  return async (args, input, timeoutMs = 10000) => {
    const name = (value: string | undefined) =>
      typeof value === 'string' &&
      /^baci-experience-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value
      );
    const parts = args.slice(3);
    const prepare =
      parts.length === 3 &&
      parts[0] === 'python3' &&
      parts[1] === '-c' &&
      parts[2] === PREPARE;
    const remove =
      parts.length === 4 &&
      parts[0] === 'python3' &&
      parts[1] === '-c' &&
      parts[2] === REMOVE_BUNDLE &&
      name(parts[3]);
    const run =
      parts.length === 6 &&
      parts[0] === '/usr/local/bin/runsc' &&
      parts[1] === `--root=${ROOT}/state` &&
      parts[2] === '--network=none' &&
      parts[3] === 'run' &&
      name(parts[5]) &&
      parts[4] === `--bundle=${ROOT}/jobs/${parts[5]}`;
    const removeContainer =
      parts.length === 5 &&
      parts[0] === '/usr/local/bin/runsc' &&
      parts[1] === `--root=${ROOT}/state` &&
      parts[2] === 'delete' &&
      parts[3] === '--force' &&
      name(parts[4]);
    if (
      args[0] !== 'ssh' ||
      args[1] !== '--' ||
      args[2] !== 'sudo' ||
      !(prepare || remove || run || removeContainer)
    )
      throw Error('INVALID_RUNNER_COMMAND');
    return await command(
      '/usr/bin/sudo',
      ['-n', ...args.slice(3)],
      input,
      timeoutMs
    );
  };
}

/** No daemon/provisioning side effects. The owner supplies a verified immutable
 * installation receipt for the existing fixed rootfs layout before HTTP ingress
 * is exposed. A missing/mismatched receipt cannot silently use a local fallback. */
export async function createLinuxRunner(config: {
  key: Uint8Array;
  toolchainDigest: string;
  verifyInstallation(): Promise<{ toolchainDigest: string }>;
}) {
  if (process.platform !== 'linux') throw Error('LINUX_RUNNER_REQUIRED');
  const installed = await config.verifyInstallation();
  if (installed.toolchainDigest !== config.toolchainDigest)
    throw Error('TOOLCHAIN_MISMATCH');
  const transport = createDirectOCITransport();
  return createRunnerHandler({
    key: config.key,
    toolchainDigest: config.toolchainDigest,
    execute: (kind, payload) => runLocalQualification(kind, payload, transport),
  });
}

/** Production candidate: the helper, not this service, owns privileged policy. */
export async function createHelperLinuxRunner(config: {
  key: Uint8Array;
  toolchainDigest: string;
  verifyInstallation(): Promise<{ toolchainDigest: string }>;
}) {
  if (process.platform !== 'linux') throw Error('LINUX_RUNNER_REQUIRED');
  const installed = await config.verifyInstallation();
  if (installed.toolchainDigest !== config.toolchainDigest)
    throw Error('TOOLCHAIN_MISMATCH');
  return createRunnerHandler({
    key: config.key,
    toolchainDigest: config.toolchainDigest,
    execute: (kind, payload) =>
      runHelperQualification(kind, payload, runCommand),
  });
}
