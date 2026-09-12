import 'dotenv/config';

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { runPetrockReconciliation } from '@/lib/imei-providers/petrock/run-petrock-reconciliation';

interface CliLogger {
  error(message: string): void;
  info(message: string, summary: string): void;
}

const PETROCK_COUNT_KEYS = [
  'claimed',
  'completed',
  'errored',
  'failed',
  'pending',
  'submissionUnknown',
] as const;
const PETROCK_DIRECT_WORKER_REQUIRED_ENV = [
  'BACI_WEB_BASE_URL',
  'IMEI_IDENTIFIER_ENCRYPTION_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'PETROCK_API_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ZEPTOMAIL_TOKEN',
] as const;

function hasPetrockDirectWorkerEnv(env: Partial<NodeJS.ProcessEnv>) {
  return PETROCK_DIRECT_WORKER_REQUIRED_ENV.every(
    (name) => Boolean(env[name]?.trim())
  );
}

function sanitizePetrockSummary({
  body,
  status,
}: Awaited<ReturnType<typeof runPetrockReconciliation>>) {
  const summary: Record<string, number | string> = {};
  if ('claimed' in body) {
    for (const key of PETROCK_COUNT_KEYS) {
      summary[key] = body[key];
    }
  }
  if ('skipped' in body && body.skipped === 'petrock_not_configured') {
    summary.skipped = body.skipped;
  }
  summary.status = status;
  return JSON.stringify(summary);
}

export function validatePetrockReconciliationOrigin(baseUrl: string) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('BACI_WEB_BASE_URL must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('BACI_WEB_BASE_URL must not contain credentials');
  }
  return parsed.origin;
}

export async function runPetrockReconciliationCli({
  env = process.env,
  logger = console,
  runJob = runPetrockReconciliation,
}: {
  env?: Partial<NodeJS.ProcessEnv>;
  logger?: CliLogger;
  runJob?: typeof runPetrockReconciliation;
} = {}): Promise<number> {
  if (!hasPetrockDirectWorkerEnv(env)) {
    logger.error('[petrock-reconciliation] preflight failed');
    return 1;
  }

  try {
    const baseUrl = env.BACI_WEB_BASE_URL as string;
    const originalConsoleError = console.error;
    const logInternalError = logger.error.bind(logger);
    console.error = () => {
      logInternalError('[petrock-reconciliation] internal error');
    };
    let result: Awaited<ReturnType<typeof runPetrockReconciliation>>;
    try {
      result = await runJob({
        origin: validatePetrockReconciliationOrigin(baseUrl),
      });
    } finally {
      console.error = originalConsoleError;
    }
    logger.info(
      '[petrock-reconciliation] completed',
      sanitizePetrockSummary(result)
    );
    return result.status >= 500 ? 1 : 0;
  } catch {
    logger.error('[petrock-reconciliation] failed');
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  runPetrockReconciliationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
