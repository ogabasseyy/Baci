import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readReplayConfiguration } from './replay-configuration';
import { runReplayDaemonCommand } from './replay-daemon-command';
import { runReplayEntrypoint } from './replay-entrypoint';
import { checkReplayReadiness } from './replay-readiness';
import { runReplaySchedule } from './replay-runtime';
import { runReplaySubprocess } from './replay-subprocess';

interface DaemonDependencies {
  signal: AbortSignal;
  read: () => Promise<unknown>;
  run: (config: unknown) => Promise<void>;
  heartbeat: () => Promise<void>;
  report: (status: 'pass-complete' | 'pass-failed') => void;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function runReplayDaemon(
  input: DaemonDependencies
): Promise<void> {
  await runReplaySchedule({
    signal: input.signal,
    wait: input.wait,
    report: input.report,
    run: async () => {
      const config = await input.read();
      await input.run(config);
      await input.heartbeat();
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pass = async () => {
    await runReplayEntrypoint(await readReplayConfiguration());
  };
  const daemon = async () => {
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort());
    process.once('SIGINT', () => controller.abort());
    await runReplayDaemon({
      signal: controller.signal,
      read: async () => null,
      run: async () => {
        await runReplaySubprocess(
          fileURLToPath(import.meta.url),
          controller.signal,
          (summary) => {
            process.stdout.write(`${JSON.stringify(summary)}\n`);
          }
        );
      },
      heartbeat: async () => {
        await writeFile('/tmp/replay-heartbeat', String(Date.now()));
      },
      report: (status) => {
        process.stdout.write(`${JSON.stringify({ replay: status })}\n`);
      },
      wait: async (milliseconds, signal) => {
        await sleep(milliseconds, undefined, { signal });
      },
    });
  };
  void runReplayDaemonCommand(process.argv.slice(2), {
    check: checkReplayReadiness,
    pass,
    daemon,
    stdout: (line) => process.stdout.write(line),
    stderr: (line) => process.stderr.write(line),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
