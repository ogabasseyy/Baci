import 'dotenv/config';

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { finalizeDueQuizEvents } from '@/lib/quiz/finalize-due-quiz-events';

interface CliLogger {
  error(message: string): void;
  info(message: string, summary: string): void;
}

const LOOP_DELAY_MS = 1_000;
type Delay = (milliseconds: number) => Promise<void>;

const defaultDelay: Delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const QUIZ_DIRECT_WORKER_REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'QUIZ_PHASE',
  'QUIZ_PRODUCTION_APPROVED',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;
const ENV_BOOLEAN_VALUES = new Set([
  '0',
  '1',
  'false',
  'no',
  'true',
  'yes',
]);

function hasQuizDirectWorkerEnv(env: NodeJS.ProcessEnv) {
  if (
    !QUIZ_DIRECT_WORKER_REQUIRED_ENV.every((name) =>
      Boolean(env[name]?.trim())
    )
  ) {
    return false;
  }

  const phase = env.QUIZ_PHASE?.trim();
  const approved = env.QUIZ_PRODUCTION_APPROVED?.trim().toLowerCase();
  if (
    (phase !== '1a' && phase !== 'production') ||
    !approved ||
    !ENV_BOOLEAN_VALUES.has(approved)
  ) {
    return false;
  }

  return (
    phase !== 'production' ||
    (Boolean(env.QUIZ_RPC_SERVER_SECRET?.trim()) &&
      Boolean(env.QUIZ_DEVICE_HASH_PEPPER?.trim()))
  );
}

function sanitizeQuizSummary({
  body,
  status,
}: Awaited<ReturnType<typeof finalizeDueQuizEvents>>) {
  const summary: Record<string, number> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'number') summary[key] = value;
  }
  summary.status = status;
  return JSON.stringify(summary);
}

export async function runQuizFinalizationCli({
  env = process.env,
  logger = console,
  runJob = finalizeDueQuizEvents,
}: {
  env?: NodeJS.ProcessEnv;
  logger?: CliLogger;
  runJob?: typeof finalizeDueQuizEvents;
} = {}): Promise<number> {
  if (!hasQuizDirectWorkerEnv(env)) {
    logger.error('[quiz-finalization] preflight failed');
    return 1;
  }

  try {
    const result = await runJob();
    logger.info('[quiz-finalization] completed', sanitizeQuizSummary(result));
    return result.status >= 500 ? 1 : 0;
  } catch {
    logger.error('[quiz-finalization] failed');
    return 1;
  }
}

export async function runQuizFinalizationLoop({
  delay = defaultDelay,
  env = process.env,
  logger = console,
  runJob = finalizeDueQuizEvents,
}: {
  delay?: Delay;
  env?: NodeJS.ProcessEnv;
  logger?: CliLogger;
  runJob?: typeof finalizeDueQuizEvents;
} = {}): Promise<number> {
  if (!hasQuizDirectWorkerEnv(env)) {
    logger.error('[quiz-finalization] preflight failed');
    return 1;
  }
  for (;;) {
    try {
      const result = await runJob();
      logger.info(
        '[quiz-finalization] completed',
        sanitizeQuizSummary(result)
      );
      if (result.status >= 500) {
        logger.error('[quiz-finalization] failed');
      }
      await delay(LOOP_DELAY_MS);
    } catch {
      logger.error('[quiz-finalization] failed');
      return 1;
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  const mode = process.argv[2] ?? '--once';
  const runner = mode === '--loop' ? runQuizFinalizationLoop() : runQuizFinalizationCli();
  runner.then((exitCode) => {
    process.exitCode = exitCode;
  });
}
