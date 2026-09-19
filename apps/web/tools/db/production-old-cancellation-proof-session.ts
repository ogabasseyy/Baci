import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

type ProofSessionFailure =
  | 'child-exit'
  | 'spawn-error'
  | 'stderr-limit'
  | 'stdin-error'
  | 'stdin-limit'
  | 'stdout-limit'
  | 'timeout';

type ProofSessionLimits = {
  stderrBytes: number;
  stdinBytes: number;
  stdoutBytes: number;
};

type ProofSessionOptions = {
  environment: Partial<NodeJS.ProcessEnv>;
  executionTimeoutMs?: number;
  limits?: ProofSessionLimits;
  psqlBin: string;
  spawnProcess?: typeof spawn;
  terminationGraceMs?: number;
};

const DEFAULT_LIMITS: ProofSessionLimits = {
  stderrBytes: 16 * 1024,
  stdinBytes: 8 * 1024 * 1024,
  stdoutBytes: 8 * 1024 * 1024,
};
const DEFAULT_TERMINATION_GRACE_MS = 1_000;

function proofFailure(reason: ProofSessionFailure): Error {
  return new Error(`Production-old cancellation proof failed: ${reason}`);
}

export function createProductionOldCancellationProofSession(
  options: ProofSessionOptions
) {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const spawnProcess = options.spawnProcess ?? spawn;
  const pgEnvironment = Object.fromEntries(
    Object.entries(options.environment).filter(
      ([key, value]) => key.startsWith('PG') && value !== undefined
    )
  );
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnProcess(
      options.psqlBin,
      ['-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--no-readline'],
      {
        env: {
          ...pgEnvironment,
          PGOPTIONS: [
            '-c statement_timeout=15s',
            '-c lock_timeout=3s',
            '-c idle_in_transaction_session_timeout=30s',
            '-c client_min_messages=warning',
          ].join(' '),
        } as unknown as NodeJS.ProcessEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ) as ChildProcessWithoutNullStreams;
  } catch {
    throw proofFailure('spawn-error');
  }
  let failed: Error | undefined;
  let closed = false;
  let inputBytes = 0;
  let outputBytes = 0;
  let stderrBytes = 0;
  let lineBuffer = '';
  let stageOutput = '';
  let pending:
    | {
        marker: string;
        reject: (error: Error) => void;
        resolve: (output: string) => void;
      }
    | undefined;
  let closePromise:
    | {
        reject: (error: Error) => void;
        resolve: () => void;
      }
    | undefined;
  let executionTimer: NodeJS.Timeout | undefined;
  let terminationTimer: NodeJS.Timeout | undefined;

  const cleanup = () => {
    if (executionTimer) clearTimeout(executionTimer);
    if (terminationTimer) clearTimeout(terminationTimer);
    child.off('error', onError);
    child.off('close', onClose);
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    child.stdin.off('error', onStdinError);
  };
  const sendSignal = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {
      // Failure remains sanitized under the original proof-session reason.
    }
  };
  const terminate = () => {
    if (closed || terminationTimer) return;
    sendSignal('SIGTERM');
    if (closed) return;
    terminationTimer = setTimeout(() => {
      terminationTimer = undefined;
      if (!closed) sendSignal('SIGKILL');
    }, options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
    terminationTimer.unref();
  };
  const fail = (reason: ProofSessionFailure): Error => {
    if (failed) return failed;
    const failure = proofFailure(reason);
    failed = failure;
    pending?.reject(failure);
    pending = undefined;
    closePromise?.reject(failure);
    closePromise = undefined;
    terminate();
    return failure;
  };
  const onStdout = (chunk: Buffer | string) => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    outputBytes += value.length;
    if (outputBytes > limits.stdoutBytes) {
      fail('stdout-limit');
      return;
    }
    lineBuffer += value.toString('utf8');
    for (;;) {
      const newline = lineBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(newline + 1);
      if (pending && line === pending.marker) {
        const current = pending;
        pending = undefined;
        const output = stageOutput;
        stageOutput = '';
        current.resolve(output);
      } else {
        stageOutput += `${line}\n`;
      }
    }
  };
  const onStderr = (chunk: Buffer | string) => {
    stderrBytes += Buffer.byteLength(chunk);
    if (stderrBytes > limits.stderrBytes) fail('stderr-limit');
  };
  const onError = () => fail('spawn-error');
  const onStdinError = () => fail('stdin-error');
  const onClose = (code: number | null) => {
    closed = true;
    cleanup();
    if (pending) {
      pending.reject(failed ?? proofFailure('child-exit'));
      pending = undefined;
    }
    if (closePromise) {
      const closing = closePromise;
      closePromise = undefined;
      if (failed) closing.reject(failed);
      else if (code === 0) closing.resolve();
      else closing.reject(proofFailure('child-exit'));
    }
  };
  executionTimer = setTimeout(
    () => fail('timeout'),
    options.executionTimeoutMs ?? 90_000
  );
  executionTimer.unref();
  child.on('error', onError);
  child.on('close', onClose);
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.stdin.on('error', onStdinError);

  const write = (input: string): Promise<void> => {
    if (failed) return Promise.reject(failed);
    const bytes = Buffer.byteLength(input);
    inputBytes += bytes;
    if (inputBytes > limits.stdinBytes) {
      return Promise.reject(fail('stdin-limit'));
    }
    return new Promise((resolve, reject) => {
      try {
        child.stdin.write(input, (error) => {
          if (error) {
            reject(fail('stdin-error'));
          } else {
            resolve();
          }
        });
      } catch {
        reject(fail('stdin-error'));
      }
    });
  };

  return {
    exchange(input: string, marker: string): Promise<string> {
      if (!/^__BACI_[A-Z0-9_]+__$/.test(marker)) {
        return Promise.reject(proofFailure('stdin-error'));
      }
      if (pending || closePromise || closed) {
        return Promise.reject(proofFailure('child-exit'));
      }
      return new Promise<string>((resolve, reject) => {
        pending = { marker, reject, resolve };
        write(`${input}\n\\echo ${marker}\n`).catch((error: Error) => {
          if (pending?.marker === marker) {
            pending = undefined;
            reject(error);
          }
        });
      });
    },
    rollbackAndClose(): Promise<void> {
      if (failed) return Promise.reject(failed);
      if (pending || closePromise || closed) {
        return Promise.reject(proofFailure('child-exit'));
      }
      return new Promise<void>((resolve, reject) => {
        closePromise = { reject, resolve };
        write('ROLLBACK;\n\\q\n').catch((error: Error) => {
          if (closePromise) {
            closePromise = undefined;
            reject(error);
          }
        });
      });
    },
  };
}
