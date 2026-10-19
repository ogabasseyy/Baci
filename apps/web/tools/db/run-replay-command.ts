import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { readSupabaseHistoryEffects } from './read-supabase-history-effects';
import { replayRepository } from './replay-repository-root';
import { supabaseHistoryEffectQueryContract } from './supabase-history-effect-query-contract';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';
import type {
  ReplayCommand,
  SupabaseHistoryEffectComparisonMode,
} from './supabase-history-replay-types';
import { createSupabaseReplayDatabaseEnvironment } from './supabase-replay-contract';
import { supabaseReplayFailureDiagnostic } from './supabase-replay-failure-diagnostic';

export type ReplayCommandLimits = {
  stderrBytes: number;
  stdinBytes: number;
  stdoutBytes: number;
};

export type ReplayCommandOptions = {
  executionTimeoutMs?: number;
  limits?: ReplayCommandLimits;
  spawnProcess?: typeof spawn;
  terminationGraceMs?: number;
};

const DEFAULT_LIMITS: ReplayCommandLimits = {
  stderrBytes: 256 * 1024,
  stdinBytes: 8 * 1024 * 1024,
  stdoutBytes: 8 * 1024 * 1024,
};
type FailureClass =
  | 'non-zero-exit'
  | 'spawn-error'
  | 'stderr-limit'
  | 'stdin-limit'
  | 'stdout-limit'
  | 'timeout';

function sanitizedCommandName(command: string): string {
  const basename = path.basename(command);
  return /^[A-Za-z0-9._-]+$/.test(basename) ? basename : 'command';
}

function boundedPsqlDiagnostic(
  command: string,
  stderr: readonly Buffer[]
): string {
  const commandName = sanitizedCommandName(command);
  if (!/^psql(?:-[A-Za-z0-9._-]+)?$/.test(commandName)) {
    return '';
  }
  const output = Buffer.concat(stderr).toString('utf8');
  const escapedCommandName = commandName.replaceAll('.', '\\.');
  const match = new RegExp(
    `^${escapedCommandName}:[^\\r\\n]*:(\\d+):[ \\t]+(?:ERROR|error):(?:[ \\t]+([0-9A-Z]{5})(?=[: \\t]|$))?`,
    'm'
  ).exec(output);
  const line = Number(match?.[1]);
  if (!Number.isSafeInteger(line) || line < 1) return '';
  return ` (line=${line}${match?.[2] ? `,sqlstate=${match[2]}` : ''})`;
}

function commandFailure(
  command: string,
  failure: FailureClass,
  stderr: readonly Buffer[] = []
): Error {
  const diagnostic =
    failure !== 'non-zero-exit'
      ? ''
      : sanitizedCommandName(command) === 'supabase'
        ? supabaseReplayFailureDiagnostic(
            Buffer.concat(stderr).toString('utf8')
          )
        : boundedPsqlDiagnostic(command, stderr);
  return new Error(
    `${sanitizedCommandName(command)} failed: ${failure}${diagnostic}`
  );
}

function createReplayCommand(
  repositoryRoot: string,
  options: ReplayCommandOptions = {}
): ReplayCommand {
  if (!path.isAbsolute(repositoryRoot)) {
    throw new Error('Replay repository root must be absolute');
  }
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const limits = options.limits ?? DEFAULT_LIMITS;

  return async (command, args, commandOptions = {}) => {
    const input = commandOptions.input ?? '';
    if (Buffer.byteLength(input) > limits.stdinBytes) {
      throw commandFailure(command, 'stdin-limit');
    }

    return await new Promise<{ stderr: string; stdout: string }>(
      (resolve, reject) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = (options.spawnProcess ?? spawn)(command, [...args], {
            cwd: canonicalRepositoryRoot,
            env: commandOptions.env,
            shell: false,
            stdio: 'pipe',
          }) as ChildProcessWithoutNullStreams;
        } catch {
          reject(commandFailure(command, 'spawn-error'));
          return;
        }
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let failure: FailureClass | undefined;
        let stdinFailed = false;
        let settled = false;
        let executionTimer: NodeJS.Timeout | undefined;
        let terminationTimer: NodeJS.Timeout | undefined;
        let terminationRequested = false;
        const cleanup = () => {
          if (executionTimer) clearTimeout(executionTimer);
          if (terminationTimer) clearTimeout(terminationTimer);
          child.stdout.off('data', onStdout);
          child.stderr.off('data', onStderr);
          child.stdin.off('error', onStdinError);
          child.off('error', onError);
          child.off('close', onClose);
        };
        const fail = (failureClass: FailureClass) => {
          failure ??= failureClass;
          if (terminationRequested || settled) return;
          terminationRequested = true;
          if (executionTimer) clearTimeout(executionTimer);
          child.kill('SIGTERM');
          if (settled) return;
          terminationTimer = setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
          }, options.terminationGraceMs ?? 5_000);
        };
        const onStdout = (chunk: Buffer | string) => {
          if (settled || failure) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutBytes += bytes.length;
          if (stdoutBytes > limits.stdoutBytes) {
            fail('stdout-limit');
            return;
          }
          stdout.push(bytes);
        };
        const onStderr = (chunk: Buffer | string) => {
          if (settled || failure) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stderrBytes += bytes.length;
          if (stderrBytes > limits.stderrBytes) {
            fail('stderr-limit');
            return;
          }
          stderr.push(bytes);
        };
        const onError = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(commandFailure(command, failure ?? 'spawn-error'));
        };
        const onClose = (code: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (failure) {
            reject(commandFailure(command, failure));
            return;
          }
          if (code !== 0 || stdinFailed) {
            reject(commandFailure(command, 'non-zero-exit', stderr));
            return;
          }
          resolve({
            stderr: Buffer.concat(stderr).toString('utf8'),
            stdout: Buffer.concat(stdout).toString('utf8'),
          });
        };
        const onStdinError = () => {
          if (!settled) stdinFailed = true;
        };
        child.stdout.on('data', onStdout);
        child.stderr.on('data', onStderr);
        child.on('error', onError);
        child.on('close', onClose);
        child.stdin.on('error', onStdinError);
        executionTimer = setTimeout(
          () => fail('timeout'),
          options.executionTimeoutMs ?? 5 * 60_000
        );
        child.stdin.end(input);
      }
    );
  };
}

async function executeReplaySelect(options: {
  databaseUrl: string;
  psqlBin: string;
  runCommand: ReplayCommand;
  sql: string;
}): Promise<unknown[]> {
  const output = (
    await options.runCommand(
      options.psqlBin,
      ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At'],
      {
        env: {
          ...createSupabaseReplayDatabaseEnvironment(options.databaseUrl),
          PGOPTIONS: '-c default_transaction_read_only=on',
        },
        input: options.sql,
      }
    )
  ).stdout.trim();
  const preflight = /^(\d+)\|(on|off)$/.exec(output);
  if (preflight) {
    return [
      {
        serverVersionNum: Number(preflight[1]),
        transactionReadOnly: preflight[2],
      },
    ];
  }
  if (/^\d+$/.test(output)) return [{ serverVersionNum: Number(output) }];
  try {
    return [{ snapshot: JSON.parse(output) }];
  } catch {
    throw new Error('Effect query output is invalid');
  }
}

async function readBoundReplayEffects(options: {
  comparisonMode?: SupabaseHistoryEffectComparisonMode;
  databaseUrl: string;
  psqlBin: string;
  repositoryRoot: string;
  runCommand: ReplayCommand;
}) {
  const query = (
    await replayRepository.readSource(
      options.repositoryRoot,
      'apps/web/tools/db/supabase-history-effects.sql'
    )
  ).toString('utf8');
  const productionFixture = (
    await replayRepository.readSource(
      options.repositoryRoot,
      supabaseHistoryReplayManifest.productionEffectsFixture.path
    )
  ).toString('utf8');
  return readSupabaseHistoryEffects({
    comparisonMode: options.comparisonMode ?? 'enforce',
    effectQuery: query,
    expectedEffectQuerySha256: supabaseHistoryEffectQueryContract.querySha256,
    executeSelect: (sql) =>
      executeReplaySelect({
        databaseUrl: options.databaseUrl,
        psqlBin: options.psqlBin,
        runCommand: options.runCommand,
        sql,
      }),
    productionFixture,
  });
}

export const replayCommandRuntime = {
  create: createReplayCommand,
  executeSelect: executeReplaySelect,
  readBoundEffects: readBoundReplayEffects,
};
