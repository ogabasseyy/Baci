import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_TIMEOUT_MS, OP_TIMEOUT_MS } from './constants.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(here, 'encode-worker.mjs');
const KILL_GRACE_MS = 2000;
const MAX_STDOUT_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 4 * 1024;

export class PilotEncodeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PilotEncodeError';
  }
}

// Process-wide serial queue: one encoding at a time. Job orchestration is
// also serial; this is defense in depth plus the kill-confirmation gate.
let queueTail = Promise.resolve();

// Max worker RSS across completed ops since the last take. Ops are
// process-serial, so a plain accumulator is race-free; each job takes
// (and resets) at its start and end. Killed or failed ops report no
// envelope and contribute nothing — the peak covers completed ops.
let peakWorkerRssBytes = 0;

export function takePeakWorkerRssBytes() {
  const peak = peakWorkerRssBytes;
  peakWorkerRssBytes = 0;
  return peak;
}

function noteWorkerPeak(result) {
  const sample = result?.workerPeakRssBytes;
  if (typeof sample === 'number' && Number.isFinite(sample) && sample > 0) {
    peakWorkerRssBytes = Math.max(peakWorkerRssBytes, Math.floor(sample));
  }
}

export function enqueuePilotOp(task) {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function deadlineRemainingMs(deadlineMs) {
  if (deadlineMs === undefined) {
    return JOB_TIMEOUT_MS;
  }
  return deadlineMs - Date.now();
}

async function spawnWorker(op, { signal, timeoutMs }) {
  const child = spawn(process.execPath, [WORKER_PATH, JSON.stringify(op)], {
    signal: undefined,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stdoutBytes = 0;
  let stdoutOverflow = false;
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      stdoutOverflow = true;
      return;
    }
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_STDERR_BYTES) {
      stderr += chunk.toString('utf8').slice(0, MAX_STDERR_BYTES - stderr.length);
    }
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signalName) => resolve({ code, signalName }));
  });
  let timer = null;
  let killTimer = null;
  let settled = false;
  const killAndWait = async () => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }
    await exited;
    if (killTimer) {
      clearTimeout(killTimer);
    }
  };
  const onAbort = () => {
    void killAndWait();
  };
  if (signal) {
    if (signal.aborted) {
      await killAndWait();
      throw new PilotEncodeError('op-cancelled', 'operation was cancelled');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const outcome = await Promise.race([
      exited.then((end) => ({ end })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (outcome.timedOut) {
      await killAndWait();
      throw new PilotEncodeError(
        'op-timeout',
        `worker op timed out after ${timeoutMs}ms`
      );
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
    }
    if (signal?.aborted) {
      throw new PilotEncodeError('op-cancelled', 'operation was cancelled');
    }
    if (outcome.end.code !== 0) {
      throw new PilotEncodeError(
        'worker-failed',
        `worker exited with code ${outcome.end.code} (${stderr.trim().slice(0, 300) || 'no stderr'})`
      );
    }
    if (stdoutOverflow) {
      throw new PilotEncodeError('worker-failed', 'worker stdout overflowed');
    }
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new PilotEncodeError('worker-failed', 'worker returned invalid JSON');
    }
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new PilotEncodeError('worker-failed', 'worker returned a bad envelope');
    }
    if (!result.ok) {
      throw new PilotEncodeError(
        result.code ?? 'worker-failed',
        result.message ?? 'worker op failed'
      );
    }
    noteWorkerPeak(result);
    return result;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
    if (timer) {
      clearTimeout(timer);
    }
    if (killTimer) {
      clearTimeout(killTimer);
    }
  }
}

export async function runWorkerOp(
  op,
  { deadlineMs, signal, timeoutMs = OP_TIMEOUT_MS } = {}
) {
  if (signal?.aborted) {
    throw new PilotEncodeError('op-cancelled', 'operation was cancelled');
  }
  return enqueuePilotOp(async () => {
    if (signal?.aborted) {
      throw new PilotEncodeError('op-cancelled', 'operation was cancelled');
    }
    const remaining = deadlineRemainingMs(deadlineMs);
    if (!(remaining > 0)) {
      throw new PilotEncodeError('job-deadline', 'absolute job deadline passed');
    }
    return spawnWorker(op, { signal, timeoutMs: Math.min(timeoutMs, remaining) });
  });
}
