import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { makeOCISpec } from './oci-policy';

const ROOT = '/var/tmp/baci-experience-checkpoint-a';
const REMOVE_BUNDLE = `import pathlib,re,shutil,sys
name=sys.argv[1]
if not re.fullmatch(r'baci-experience-[a-z0-9-]+',name):raise ValueError('bad name')
shutil.rmtree(pathlib.Path('${ROOT}/jobs')/name)`;
const PREPARE = `import json,sys,pathlib,re
r=json.load(sys.stdin);name=r['name']
if not re.fullmatch(r'baci-experience-[a-z0-9-]+',name):raise ValueError('bad name')
b=pathlib.Path('${ROOT}/jobs')/name;b.mkdir(parents=True,exist_ok=False)
spec=r['spec'];spec['linux']['cgroupsPath']='/baci-experience-checkpoint-a/'+name
(b/'config.json').write_text(json.dumps(spec))`;
export type QualificationKind =
  | 'compile'
  | 'capture'
  | 'performance'
  | 'checks'
  | 'prerender'
  | 'prerender-checks'
  | 'prerender-build'
  | 'prerender-private-checks'
  | 'durable-public-checks';
export type LocalTransport = (
  args: string[],
  input?: string,
  timeoutMs?: number
) => Promise<string>;
/** One allowance shared by both child output streams. */
export function outputBudgetExceeded(limit = 16 * 1024 * 1024) {
  let bytes = 0;
  return (chunk: Buffer | string) => {
    bytes += Buffer.byteLength(chunk);
    return bytes > limit;
  };
}
const exec = promisify(execFile);
const localTransport: LocalTransport = async (
  args,
  input,
  timeoutMs = 10000
) => {
  const child = exec('colima', args, {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'C.UTF-8',
      NODE_ENV: 'test',
    },
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
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
  child.child.stdin?.on('error', () => {
    // The awaited process reports the failure; stream errors must not crash cleanup.
  });
  child.child.stdin?.end(input);
  try {
    const result = await child;
    if (overflow) throw Error('Output budget');
    return result.stdout;
  } catch (error) {
    if (overflow)
      throw Object.assign(new Error('Combined output budget exceeded'), {
        code: 'EXPERIENCE_OUTPUT_BUDGET',
      });
    throw error;
  }
};
async function cleanupQualification(
  name: string,
  transport: LocalTransport,
  executionFailed: boolean
): Promise<void> {
  // Never delete another caller's sandbox or use a global Docker prune.
  try {
    await transport([
      'ssh',
      '--',
      'sudo',
      '/usr/local/bin/runsc',
      `--root=${ROOT}/state`,
      'delete',
      '--force',
      name,
    ]);
    // Retain the bundle if deletion failed: the sandbox may still be running.
    await transport([
      'ssh',
      '--',
      'sudo',
      'python3',
      '-c',
      REMOVE_BUNDLE,
      name,
    ]);
  } catch (cleanupError) {
    if (!executionFailed) throw cleanupError;
    // Preserve the original deadline/output-budget error and its error code.
    console.error(`Local qualification cleanup failed for ${name}`);
  }
}

/** Local test CLI only. No daemon changes, host binds, credentials or readiness grants. */
export async function runLocalQualification(
  kind: QualificationKind,
  payload: unknown,
  transport: LocalTransport = localTransport
): Promise<{ output: unknown; wallMs: number; jobId: string }> {
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > 8 * 1024 * 1024)
    throw new Error('Input budget');
  const name = `baci-experience-${randomUUID()}`;
  const isBuild =
    kind === 'compile' || kind === 'prerender' || kind === 'prerender-build';
  const root = isBuild ? 'node24' : 'browser';
  const entry =
    kind === 'performance'
      ? 'performance-worker.mjs'
      : kind === 'durable-public-checks'
        ? 'public-browser-worker.mjs'
        : kind === 'prerender-private-checks'
          ? 'private-preview-browser-worker.mjs'
          : kind === 'prerender-build'
            ? 'prerender-build-worker.mjs'
            : kind === 'compile'
              ? 'compile-runtime.mjs'
              : kind === 'prerender'
                ? 'prerender-worker.mjs'
                : kind === 'prerender-checks'
                  ? 'prerender-browser-worker.mjs'
                  : kind === 'capture'
                    ? 'capture-worker.mjs'
                    : 'browser-checks.mjs';
  const spec = makeOCISpec(
    `${ROOT}/${root}/rootfs`,
    ['/usr/local/bin/node', `/opt/experience/${entry}`],
    isBuild ? 'build' : 'capture'
  );
  if (!isBuild)
    spec.process.env.push(
      'HOME=/tmp',
      'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'
    );
  await transport(
    ['ssh', '--', 'sudo', 'python3', '-c', PREPARE],
    JSON.stringify({ name, spec })
  );
  const started = performance.now();
  let executionFailed = false;
  try {
    const stdout = await transport(
      [
        'ssh',
        '--',
        'sudo',
        '/usr/local/bin/runsc',
        `--root=${ROOT}/state`,
        '--network=none',
        'run',
        `--bundle=${ROOT}/jobs/${name}`,
        name,
      ],
      input,
      isBuild || kind === 'capture' ? 60000 : 30000
    );
    if (Buffer.byteLength(stdout) > 16 * 1024 * 1024)
      throw new Error('Output budget');
    const output: unknown = JSON.parse(stdout);
    if (!output || typeof output !== 'object' || Array.isArray(output))
      throw new Error('Invalid candidate output');
    return {
      output,
      wallMs: Math.round(performance.now() - started),
      jobId: name,
    };
  } catch (error) {
    executionFailed = true;
    throw error;
  } finally {
    await cleanupQualification(name, transport, executionFailed);
  }
}
