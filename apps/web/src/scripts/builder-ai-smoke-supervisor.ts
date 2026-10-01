import { fork } from 'node:child_process';

export type BuilderAiSmokeWorkerCommand =
  | { kind: 'list'; sourcePath: string }
  | { deadlineMs: number; kind: 'probe'; providerName: string; sourcePath: string };

export type BuilderAiSmokeWorkerResult =
  | { kind: 'providers'; providers: Array<{ name: string; opportunistic?: boolean }> }
  | { kind: 'probe'; passed: boolean }
  | { kind: 'timeout' }
  | { kind: 'error' };

interface WorkerMessage {
  kind: 'providers' | 'probe' | 'started';
  passed?: boolean;
  providers?: Array<{ name: string; opportunistic?: boolean }>;
}

export interface BuilderAiSmokeSupervisorOptions {
  deadlineMs: number;
  onChildStarted?: (pid: number) => void;
  workerArgs?: string[];
  workerPath: string;
}

function allowedResult(message: WorkerMessage): BuilderAiSmokeWorkerResult {
  if (message.kind === 'providers' && Array.isArray(message.providers)) {
    return { kind: 'providers', providers: message.providers };
  }
  return message.kind === 'probe'
    ? { kind: 'probe', passed: message.passed === true }
    : { kind: 'error' };
}

export function runBuilderAiSmokeWorkerCommand(
  command: BuilderAiSmokeWorkerCommand,
  options: BuilderAiSmokeSupervisorOptions
): Promise<BuilderAiSmokeWorkerResult> {
  return new Promise((resolve) => {
    const child = fork(options.workerPath, options.workerArgs ?? [], {
      execArgv: process.execArgv,
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    options.onChildStarted?.(child.pid ?? -1);
    let settled = false;
    const finish = (result: BuilderAiSmokeWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill('SIGKILL');
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ kind: 'timeout' }), options.deadlineMs);
    child.once('error', () => finish({ kind: 'error' }));
    child.once('exit', () => finish({ kind: 'error' }));
    child.on('message', (message: WorkerMessage) => {
      if (message.kind !== 'started') finish(allowedResult(message));
    });
    child.send(command, (error) => {
      if (error) finish({ kind: 'error' });
    });
  });
}
