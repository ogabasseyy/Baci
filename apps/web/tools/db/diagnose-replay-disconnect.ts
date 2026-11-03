import type { ReplayProjectCleanupResult } from './replay-project-ownership';
import type { ReplayCommand } from './supabase-history-replay-types';
import {
  type ExpectedSupabaseReplayResources,
  type ObservedSupabaseReplayResources,
  SUPABASE_PROJECT_LABEL,
} from './supabase-replay-expected-resources';

export function withCleanupDiagnostics(
  failure: unknown,
  cleanup: ReplayProjectCleanupResult | undefined
): unknown {
  if (cleanup?.resourceReadiness !== 'anomalous') return failure;
  const primary =
    failure instanceof Error ? failure : new Error('Supabase replay failed');
  return Object.assign(new Error(primary.message, { cause: primary }), {
    name: primary.name,
    replayDiagnostics: { cleanup },
  });
}

/** Only fixed, aggregate diagnostics escape the owned disposable container. */
export async function diagnoseReplayDisconnect(
  failure: unknown,
  projectId: string,
  expected: ExpectedSupabaseReplayResources | undefined,
  inspect: () => Promise<ObservedSupabaseReplayResources>,
  run: ReplayCommand
): Promise<unknown> {
  if (
    !(failure instanceof Error) ||
    !/^Replay SQL check failed at ordinal \d+: non-zero-exit \(line=\d+,shape=[01]{4}(?:,checkpoint=1)?,exit=2\)$/.test(
      failure.message
    ) ||
    !/^baci_replay_[a-f0-9]{24}$/.test(projectId)
  )
    return failure;
  const dbName = `supabase_db_${projectId}`;
  if (!expected?.containers.some((container) => container.name === dbName))
    return failure;
  try {
    const resources = await inspect();
    if (
      !resources.containers.some(
        (container) =>
          container.name === dbName &&
          container.labels[SUPABASE_PROJECT_LABEL] === projectId
      )
    )
      return failure;
    const state = (
      await run('docker', [
        'inspect',
        '--format',
        '{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.RestartCount}}|{{.State.Status}}',
        dbName,
      ])
    ).stdout.trim();
    const stateMatch =
      /^(true|false)\|(\d+)\|(\d+)\|(running|exited|restarting|dead|created|paused)$/.exec(
        state
      );
    if (!stateMatch) return failure;
    let logs = '';
    let logsRead = false;
    try {
      const output = await run('docker', [
        'logs',
        '--tail',
        '1000',
        '--since',
        '2m',
        dbName,
      ]);
      logs = `${output.stdout}\n${output.stderr}`;
      logsRead = true;
    } catch {
      // An unavailable log is not evidence of a healthy server.
    }
    const flags = [
      stateMatch[1] === 'true',
      Number(stateMatch[2]) !== 0,
      Number(stateMatch[3]) > 0,
      stateMatch[4] !== 'running',
      /server process[^\n]*(?:signal|segmentation)/i.test(logs),
      /\bPANIC\b/i.test(logs),
      /out of memory|oom.kill/i.test(logs),
      /terminating connection|statement timeout|idle.session timeout/i.test(
        logs
      ),
      logsRead,
    ]
      .map((flag) => (flag ? '1' : '0'))
      .join('');
    const probeMatch =
      /server process[^\n]*\bsignal\s+(\d+)\b[\s\S]{0,2048}?Failed process was running:[\s\S]{0,8192}?OXYGEN_CI_ANON_DRAFT_PROBE/i.exec(
        logs
      );
    const signal =
      probeMatch?.[1] ??
      /server process[^\n]*\bsignal\s+(\d+)\b/i.exec(logs)?.[1];
    const signalClass =
      signal === '9'
        ? 'kill'
        : signal === '11'
          ? 'segv'
          : signal === '6'
            ? 'abort'
            : signal
              ? 'other'
              : 'none';
    const phases = ['BEFORE_CALL', 'DENIED', 'OTHER_ERROR']
      .map((phase) =>
        new RegExp(`WARNING:\\s+OXYGEN_CI_ANON_${phase}\\b`).test(logs)
          ? '1'
          : '0'
      )
      .join('');
    return new Error(
      `${failure.message} (dbflags=${flags},dbsignal=${signalClass},dbprobe=${probeMatch ? '1' : '0'},dbphases=${phases})`,
      {
        cause: failure,
      }
    );
  } catch {
    return failure;
  }
}
