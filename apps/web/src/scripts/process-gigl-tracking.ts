import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { runGiglTrackingMonitorBatch } from '@/app/api/cron/gigl-tracking/run-gigl-tracking-monitor-batch';
import { createGiglTrackingWorkerClient } from '@/lib/gigl-tracking-worker-client';

interface CliLogger {
  error(message: string): void;
  info(message: string, summary: string): void;
}

type RunBatch = (options: {
  batchSize: number;
}) => Promise<Awaited<ReturnType<typeof runGiglTrackingMonitorBatch>>>;

const REQUIRED_ENV = [
  'GIGL_BASE_URL',
  'GIGL_EMAIL',
  'GIGL_PASSWORD',
  'GIGL_TRACKING_WORKER_TOKEN',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
] as const;

function hasRequiredEnv(env: NodeJS.ProcessEnv) {
  return REQUIRED_ENV.every((name) => Boolean(env[name]?.trim()));
}

function isSafeProviderUrl(value: string | undefined) {
  try {
    const parsed = new URL(value ?? '');
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isExplicitlyDisabled(value: string | undefined) {
  return ['0', 'false', 'off'].includes(value?.trim().toLowerCase() ?? '');
}

async function runBatchDirectly(
  { batchSize }: { batchSize: number },
  env: NodeJS.ProcessEnv = process.env
) {
  return runGiglTrackingMonitorBatch({
    batchSize,
    client: createGiglTrackingWorkerClient(env),
    workerId: `gigl-tracking-vps-${randomUUID()}`,
  });
}

export async function runGiglTrackingCli({
  env = process.env,
  logger = console,
  runBatch = (options) => runBatchDirectly(options, env),
}: {
  env?: NodeJS.ProcessEnv;
  logger?: CliLogger;
  runBatch?: RunBatch;
} = {}): Promise<number> {
  if (isExplicitlyDisabled(env.GIGL_ENABLED)) {
    logger.info(
      '[gigl-tracking] completed',
      JSON.stringify({
        applied: 0,
        claimed: 0,
        failed: 0,
        paused: 0,
        success: true,
      })
    );
    return 0;
  }
  if (!hasRequiredEnv(env) || !isSafeProviderUrl(env.GIGL_BASE_URL)) {
    logger.error('[gigl-tracking] preflight failed');
    return 1;
  }

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const emitError = logger.error.bind(logger);
  console.error = () => emitError('[gigl-tracking] internal error');
  console.warn = () => emitError('[gigl-tracking] internal warning');

  try {
    const result = await runBatch({ batchSize: 25 });
    if (!result.ok) {
      emitError('[gigl-tracking] failed');
      return 1;
    }

    const { applied, claimed, failed, paused, success } = result.summary;
    logger.info(
      '[gigl-tracking] completed',
      JSON.stringify({ applied, claimed, failed, paused, success })
    );
    return 0;
  } catch {
    emitError('[gigl-tracking] failed');
    return 1;
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  runGiglTrackingCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
