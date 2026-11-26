import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type LinuxRunnerCommand, runCommand } from './linux-runner';
import { runPublicCartChannel } from './public-cart-channel';
import { publicObservationTimeoutMs } from './public-observation-deadline';
import { MAX_PUBLIC_OBSERVATION_START_BYTES } from './public-observation-resource-limit';

const helper = '/usr/local/libexec/baci-experience-helper';
type Request = { url: string; method: 'GET' | 'POST'; body?: string };
type Start = (jobId: string) => ChildProcessWithoutNullStreams;
const start: Start = (jobId) =>
  spawn('/usr/bin/sudo', ['-n', helper, 'run', jobId], {
    stdio: 'pipe',
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      NODE_ENV: 'production',
    },
  });
type ObserverInput = {
  payload: unknown;
  routeCount?: number;
  signal?: AbortSignal;
  session(request: Request): Promise<{ status: number; body: string }>;
};
type HelperDependencies = { command: LinuxRunnerCommand; start: Start };
const helperDependencies: HelperDependencies = { command: runCommand, start };

/** Fixed helper lifecycle; not registered as an ingress job until installed. */
export async function runPublicObservationJob(
  input: ObserverInput,
  deps: HelperDependencies = helperDependencies,
  onCleanupFailure?: () => void
) {
  input.signal?.throwIfAborted();
  const timeoutMs = publicObservationTimeoutMs(input.routeCount ?? 1);
  const encoded = JSON.stringify({ type: 'start', payload: input.payload });
  if (
    typeof encoded !== 'string' ||
    Buffer.byteLength(encoded) > MAX_PUBLIC_OBSERVATION_START_BYTES
  )
    throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
  const jobId = `baci-experience-${randomUUID()}`;
  const invoke = (action: 'prepare' | 'delete') =>
    deps.command(
      '/usr/bin/sudo',
      [
        '-n',
        helper,
        action,
        ...(action === 'prepare' ? ['public-observe', jobId] : [jobId]),
      ],
      undefined,
      15000
    );
  try {
    await invoke('prepare');
  } catch {
    // The helper may have prepared the job before its caller timed out.
    try {
      await invoke('delete');
    } catch {
      onCleanupFailure?.();
      console.error('Public observation job preparation unresolved', { jobId });
      throw Error('PUBLIC_OBSERVATION_PREPARE_UNCERTAIN');
    }
    throw Error('PUBLIC_OBSERVATION_FAILED');
  }
  const started = performance.now();
  let failure: unknown;
  let output: Record<string, unknown> | undefined;
  try {
    input.signal?.throwIfAborted();
    const child = deps.start(jobId);
    child.stdin.on('error', () => undefined);
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) child.kill('SIGKILL');
    });
    const exit = new Promise<number | null>((resolve) => {
      child.once('error', () => undefined);
      child.once('close', resolve);
    });
    const stop = () => {
      child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    input.signal?.addEventListener('abort', stop, { once: true });
    const deadline = setTimeout(stop, timeoutMs);
    try {
      await new Promise<void>((resolve, reject) =>
        child.stdin.write(`${encoded}\n`, (error) =>
          error ? reject(error) : resolve()
        )
      );
      const observed = await runPublicCartChannel({
        input: child.stdout,
        output: child.stdin,
        timeoutMs,
        session: (request) => {
          input.signal?.throwIfAborted();
          return input.session(request);
        },
      });
      if (
        (await exit) !== 0 ||
        input.signal?.aborted ||
        stderrBytes > 65536 ||
        !observed ||
        typeof observed !== 'object' ||
        Array.isArray(observed)
      )
        throw Error();
      output = observed as Record<string, unknown>;
    } finally {
      clearTimeout(deadline);
      input.signal?.removeEventListener('abort', stop);
      stop();
      await exit;
    }
  } catch {
    failure = Error('PUBLIC_OBSERVATION_FAILED');
  }
  try {
    await invoke('delete');
  } catch {
    onCleanupFailure?.();
    console.error('Public observation job cleanup failed', { jobId });
    throw Error('PUBLIC_OBSERVATION_CLEANUP_FAILED');
  }
  if (failure || !output) throw failure ?? Error('PUBLIC_OBSERVATION_FAILED');
  return { output, wallMs: Math.round(performance.now() - started), jobId };
}

export function createPublicObservationExecutor(
  deps: HelperDependencies = helperDependencies
) {
  let reconciliationRequired = false;
  return (input: ObserverInput) => {
    if (reconciliationRequired)
      return Promise.reject(
        Error('PUBLIC_OBSERVATION_RECONCILIATION_REQUIRED')
      );
    return runPublicObservationJob(input, deps, () => {
      reconciliationRequired = true;
    });
  };
}
