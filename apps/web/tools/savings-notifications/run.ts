import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSavingsNotificationPushWorker } from '../../src/lib/savings-notifications/push-worker-runtime';

type WorkerResult = Awaited<
  ReturnType<typeof runSavingsNotificationPushWorker>
>;

type CliDependencies = {
  args?: readonly string[];
  runWorker?: typeof runSavingsNotificationPushWorker;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
};

function safeAggregate(result: WorkerResult) {
  return {
    enabled: result.enabled,
    enqueued: result.enqueued,
    claimed: result.claimed,
    accepted: result.accepted,
    rejected: result.rejected,
    unknown: result.unknown,
    finishFailed: result.finishFailed,
    receiptChecked: result.receiptChecked,
    receiptProviderConfirmed: result.receiptProviderConfirmed,
    receiptFailed: result.receiptFailed,
    receiptPending: result.receiptPending,
    receiptRecordFailed: result.receiptRecordFailed,
  };
}

export async function runSavingsNotificationsCli(
  dependencies: CliDependencies = {}
): Promise<number> {
  const runWorker = dependencies.runWorker ?? runSavingsNotificationPushWorker;
  const writeOutput = dependencies.writeOutput ?? console.log;
  const writeError = dependencies.writeError ?? console.error;
  const args = dependencies.args ?? process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === '--check';
  if (args.length > 0 && !checkOnly) {
    writeError('Invalid savings notification worker arguments.');
    return 64;
  }

  try {
    const result = checkOnly
      ? await runWorker({ checkOnly: true })
      : await runWorker();
    if (!result.enabled) {
      writeError('Savings notification worker is disabled.');
      return 2;
    }
    writeOutput(JSON.stringify(safeAggregate(result)));
    if (result.finishFailed > 0 || result.receiptRecordFailed > 0) {
      writeError('Savings notification worker persistence failures detected.');
      return 3;
    }
    return 0;
  } catch {
    writeError('Savings notification worker failed; details withheld.');
    return 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url))
) {
  void runSavingsNotificationsCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
