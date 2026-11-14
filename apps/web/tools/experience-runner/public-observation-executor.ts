import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type LinuxRunnerCommand, runCommand } from './linux-runner';
import { runPublicCartChannel } from './public-cart-channel';

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

/** Fixed helper lifecycle; not registered as an ingress job until installed. */
export async function runPublicObservationJob(
  input: {
    payload: unknown;
    session(request: Request): Promise<{ status: number; body: string }>;
  },
  deps: { command: LinuxRunnerCommand; start: Start } = {
    command: runCommand,
    start,
  }
) {
  const encoded = JSON.stringify({ type: 'start', payload: input.payload });
  if (
    typeof encoded !== 'string' ||
    Buffer.byteLength(encoded) > 8 * 1024 * 1024
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
    throw Error('PUBLIC_OBSERVATION_PREPARE_UNCERTAIN');
  }
  const started = performance.now();
  let failure: unknown;
  let output: Record<string, unknown> | undefined;
  try {
    const child = deps.start(jobId);
    child.stdin.on('error', () => undefined);
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) child.kill('SIGKILL');
    });
    const exit = new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(null));
      child.once('close', resolve);
    });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 75000);
    try {
      await new Promise<void>((resolve, reject) =>
        child.stdin.write(`${encoded}\n`, (error) =>
          error ? reject(error) : resolve()
        )
      );
      const observed = await runPublicCartChannel({
        input: child.stdout,
        output: child.stdin,
        session: input.session,
      });
      if (
        (await exit) !== 0 ||
        stderrBytes > 65536 ||
        !observed ||
        typeof observed !== 'object' ||
        Array.isArray(observed)
      )
        throw Error();
      output = observed as Record<string, unknown>;
    } finally {
      clearTimeout(deadline);
      child.kill('SIGKILL');
    }
  } catch {
    failure = Error('PUBLIC_OBSERVATION_FAILED');
  }
  try {
    await invoke('delete');
  } catch {
    throw Error('PUBLIC_OBSERVATION_CLEANUP_FAILED');
  }
  if (failure || !output) throw failure ?? Error('PUBLIC_OBSERVATION_FAILED');
  return { output, wallMs: Math.round(performance.now() - started), jobId };
}
