import 'dotenv/config';

import { execFile } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { collectCaptureDrainEvidence } from '@/lib/piggyvest/webhook-capture-drain-readiness';
import {
  type CaptureDrainRuntimeDeps,
  readPiggyvestCaptureDrainRuntime,
  runPiggyvestWebhookCaptureDrain,
} from '@/lib/piggyvest/webhook-capture-drain-runtime';
import { createCaptureDrainPgExecutor } from '@/lib/piggyvest/webhook-capture-pg-executor';
import { inspectPiggyvestWebhookCaptureReadiness } from '@/lib/piggyvest/webhook-capture-readiness';

/**
 * Worker-host entry point of the PiggyVest webhook capture drain (R5),
 * started every minute by vps-workers/bin/process-piggyvest-webhook-capture-drain.sh.
 *
 * --once       one bounded pass; a no-op that opens no connection unless
 *              PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true on this host
 * --readiness  connects as the drain login, reads only the metadata
 *              counters, and prints the readiness report (exit 0 once
 *              every gate this host can check passes: login, schedule,
 *              family keys, primary intakes, alert delivery and a fresh
 *              backlog)
 * --plan       prints what the drain does; reads nothing
 *
 * Output is counts, gate names and reasons only: never a body, signature,
 * key, password or database detail.
 */

const MODES = ['--once', '--readiness', '--plan'] as const;
type Mode = (typeof MODES)[number];

const PLAN =
  'Plan only: no database or provider operations. --once claims at most 10 captured PiggyVest deliveries as the dedicated drain login, re-verifies each stored signature, replays rows a primary intake owns through that intake, and sets legacy-family rows aside for review with an alert (a row signed by a key this host lacks waits instead). It does nothing unless PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true on this host.';
const UNCONFIGURED =
  'PiggyVest capture drain login is not configured; nothing was claimed.';
const FAILURE =
  'PiggyVest capture drain unavailable; captured deliveries stay pending and are retried on a later pass.';

/** The installed crontab of the user running the drain, or null. */
export function readInstalledCrontab(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('crontab', ['-l'], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });
}

export async function runPiggyvestWebhookCaptureDrainCli(input: {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
  deps?: CaptureDrainRuntimeDeps & {
    readCrontab?: () => Promise<string | null>;
  };
}): Promise<number> {
  const write =
    input.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  const mode = input.argv[0] as Mode | undefined;
  if (input.argv.length !== 1 || !mode || !MODES.includes(mode)) {
    write('PiggyVest capture drain requires --once, --readiness or --plan');
    return 1;
  }
  if (mode === '--plan') {
    write(PLAN);
    return 0;
  }
  const env = input.env ?? process.env;
  const deps = input.deps ?? {};
  try {
    if (mode === '--readiness') {
      const runtime = readPiggyvestCaptureDrainRuntime(env);
      const executor = runtime
        ? (deps.createExecutor ?? createCaptureDrainPgExecutor)(runtime)
        : null;
      const evidence = await collectCaptureDrainEvidence({
        env,
        now: deps.now?.() ?? new Date(),
        executor,
        readCrontab: deps.readCrontab ?? readInstalledCrontab,
      });
      const report = inspectPiggyvestWebhookCaptureReadiness(evidence);
      write(JSON.stringify(report));
      return report.readyToAttest ? 0 : 1;
    }
    const run = await runPiggyvestWebhookCaptureDrain({ env, deps });
    if (run.status === 'disabled') {
      write('{"status":"disabled"}');
      return 0;
    }
    if (run.status === 'unconfigured') {
      write(UNCONFIGURED);
      return 1;
    }
    if (
      run.status === 'intake_not_ready' ||
      run.status === 'legacy_intake_not_ready'
    ) {
      write(JSON.stringify(run));
      return 1;
    }
    write(JSON.stringify({ status: 'drained', ...run.summary }));
    return 0;
  } catch {
    write(FAILURE);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runPiggyvestWebhookCaptureDrainCli({ argv: process.argv.slice(2) }).then(
    (status) => {
      process.exitCode = status;
    }
  );
}
