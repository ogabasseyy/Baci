import { pathToFileURL } from 'node:url';
import type {
  PiggyvestCaptureRequeueResult,
  PiggyvestReviewCapture,
} from '@/schemas/piggyvest/webhook-capture-operator-replay';
import {
  createOperatorStore,
  OperatorRefusal,
  type OperatorStore,
} from './operator-store';
import { parseOperatorArgs, UsageError } from './parse-args';

/**
 * Operator replay of PiggyVest webhook captures parked as needs_review.
 *
 * PiggyVest cannot resend a webhook, so a parked capture is the only copy of
 * its event. After the cause is fixed, an operator requeues it here; the
 * regular capture drain then claims it, re-verifies the stored signature
 * against the current and archived keys, and processes it. Ledgers dedupe on
 * the provider keys, so requeueing an event that was already credited
 * credits nothing twice. Every requeue writes an append-only audit row.
 *
 * Run from apps/web:
 *   pnpm piggyvest:capture-replay list
 *   pnpm piggyvest:capture-replay requeue <capture-id> --reason "<why>" [--yes]
 */

export const OPERATOR_DATABASE_URL_ENV =
  'PIGGYVEST_CAPTURE_OPERATOR_DATABASE_URL';

export const USAGE = `PiggyVest capture replay (operator)

Commands:
  list [--limit N] [--offset M]                  parked captures (metadata only), newest first;
                                                 --offset skips M rows to page further
  requeue <capture-id> --reason "<why>" [--yes]  put one parked capture back in the drain queue;
                                                 without --yes it only shows what would happen

Environment:
  ${OPERATOR_DATABASE_URL_ENV}  connection string of YOUR operator login (a member of
                 piggyvest_webhook_capture_operator). Never the service-role key or postgres.
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const processIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

export function describeRequeue(result: PiggyvestCaptureRequeueResult): string {
  switch (result.outcome) {
    case 'requeued':
      return `Requeued (audit #${result.auditId}, operator replay ${result.operatorReplays} of ${result.replayLimit}). It was parked after ${result.previousAttempts} attempts with ${result.previousLastError ?? 'no error'}. The drain picks it up on its next run.`;
    case 'not_found':
      return 'No capture has that id. Nothing changed.';
    case 'not_in_review':
      return `That capture is ${result.processingState}, not parked for review. Nothing changed.`;
    case 'credit_dedupe_missing':
      return `That capture is a credit event (${result.eventType ?? 'unknown type'}) and the credit ledgers do not yet dedupe on pvb_reference (PR #4199 is not deployed here). Replaying it could credit twice, so nothing changed.`;
    case 'replay_limit_reached':
      return `That capture was already requeued ${result.operatorReplays} times (the limit is ${result.replayLimit}). Nothing changed; it needs a code fix, not another replay.`;
  }
}

const PREVIEW_PAGE = 200;

/** Every parked capture, a page at a time, until the id is found. */
async function findParked(
  store: OperatorStore,
  captureId: string
): Promise<PiggyvestReviewCapture | undefined> {
  for (let offset = 0; ; offset += PREVIEW_PAGE) {
    const page = await store.list(PREVIEW_PAGE, offset);
    const match = page.find((capture) => capture.captureId === captureId);
    if (match || page.length < PREVIEW_PAGE) return match;
  }
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: CliIo = processIo,
  createStore: (connectionString: string) => OperatorStore = (
    connectionString
  ) => createOperatorStore({ connectionString })
): Promise<number> {
  let command: ReturnType<typeof parseOperatorArgs>;
  try {
    command = parseOperatorArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`${error.message}\n\n${USAGE}`);
    return 64;
  }
  if (command.kind === 'help') {
    io.out(USAGE);
    return 0;
  }

  const connectionString = env[OPERATOR_DATABASE_URL_ENV]?.trim();
  if (!connectionString) {
    io.err(
      `Refused: ${OPERATOR_DATABASE_URL_ENV} is not set. Nothing was read or changed.`
    );
    return 77;
  }
  try {
    const store = createStore(connectionString);
    if (command.kind === 'list') {
      const captures = await store.list(command.limit, command.offset);
      if (captures.length === 0) io.out('No captures are parked for review.');
      for (const capture of captures)
        io.out(
          [
            capture.captureId,
            capture.eventType ?? '(unknown event)',
            `txn=${capture.providerTransactionId ?? '-'}`,
            `attempts=${capture.attempts}`,
            `error=${capture.lastError ?? '-'}`,
            `received=${capture.receivedAt}`,
            `replays=${capture.operatorReplays}`,
          ].join('  ')
        );
      return 0;
    }

    if (!command.confirmed) {
      const match = await findParked(store, command.captureId);
      io.out(
        match
          ? `Would requeue ${match.captureId} (${match.eventType ?? 'unknown event'}, ${match.lastError ?? 'no error'}) with reason "${command.reason}". Re-run with --yes to do it.`
          : `${command.captureId} is not parked for review. Check the id with \`list\` before requeueing. Nothing changed.`
      );
      return match ? 0 : 1;
    }

    const result = await store.requeue(command.captureId, command.reason);
    io.out(describeRequeue(result));
    return result.outcome === 'requeued' ? 0 : 1;
  } catch (error) {
    if (error instanceof OperatorRefusal) {
      io.err(`Refused: ${error.message}. Nothing was changed.`);
      return 77;
    }
    io.err(
      'Failed: the database request did not complete. Nothing is known to have changed; run `list` to check.'
    );
    return 70;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
