import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseApproveArgs } from './approve-args';
import {
  type ApproverConnectionConfig,
  type ApproverSession,
  buildConnectionConfig,
  OpsRefusal,
  openApproverSession,
} from './approve-db';
import {
  describeRequest,
  formatNaira,
  parseNairaInput,
  refusalMessage,
} from './approve-format';
import { createHiddenPrompt, createLinePrompt } from './approve-prompt';

/**
 * Two-person approvals: list and decide PiggyVest ops requests as yourself.
 *
 * Run from apps/web on your own machine (see docs/runbooks/piggyvest-approvals.md):
 *
 *   ../../node_modules/.bin/tsx tools/piggyvest-ops/approve.ts --host <db host> --user <your login>
 */
export const USAGE = `PiggyVest two-person approvals

  --host <host>        database host (required)
  --user <login>       your personal approver login (required)
  --port <port>        default 5432
  --database <name>    default postgres
  --ca <file>          the database server's CA certificate (PEM)
  --request <id>       the request to decide; without it, open requests are listed
  --reject             reject instead of approve (any reject closes the request)
  --commit             record the decision; without it this is a dry run

Your password is asked for at a hidden prompt. It is never read from the
command line, the environment or a file. Before anything is recorded you
retype the naira amount shown.`;

export interface ApproveDeps {
  out: (text: string) => void;
  err: (text: string) => void;
  isInteractive: () => boolean;
  promptHidden: (question: string) => Promise<string>;
  promptLine: (question: string) => Promise<string>;
  readCertificate: (path: string) => Promise<string>;
  connect: (config: ApproverConnectionConfig) => Promise<ApproverSession>;
}

async function decideOne(
  session: ApproverSession,
  requestId: string,
  decision: 'approve' | 'reject',
  commit: boolean,
  deps: ApproveDeps
): Promise<number> {
  const request = (await session.listOpen()).find(
    (row) => row.requestId === requestId
  );
  if (!request) {
    deps.err(
      'That request is not open for you: it may be closed or expired, opened by you, or not exist.'
    );
    return 1;
  }
  if (request.decidedByYou) {
    deps.err('You have already decided this request.');
    return 1;
  }
  for (const line of describeRequest(request)) deps.out(line);
  deps.out(`You are about to ${decision} this request.`);
  const typed = await deps.promptLine(
    `Retype the amount (${formatNaira(request.amountKobo)}) to confirm: `
  );
  if (parseNairaInput(typed) !== request.amountKobo) {
    deps.err('The amount you typed does not match. Nothing was recorded.');
    return 1;
  }
  const noun = decision === 'approve' ? 'approval' : 'rejection';
  if (!commit) {
    deps.out(
      `Dry run: nothing was recorded. Re-run with --commit to record your ${noun}.`
    );
    return 0;
  }
  let result: Awaited<ReturnType<ApproverSession['decide']>>;
  try {
    result = await session.decide({
      requestId,
      decision,
      amountKobo: request.amountKobo,
      digest: request.digest,
    });
  } catch (error) {
    if (error instanceof OpsRefusal) throw error;
    // Sent, but no confirmed reply: the outcome is unknown, not "nothing".
    deps.err(
      'The database did not confirm your decision, so it may or may not have been recorded. Run the same command without --commit to check before trying again.'
    );
    return 1;
  }
  deps.out(
    `Recorded your ${noun}. Approvals so far: ${result.approvals} of 2. Request is ${result.state}.`
  );
  return 0;
}

export async function main(
  argv: readonly string[],
  deps: ApproveDeps
): Promise<number> {
  const parsed = parseApproveArgs(argv);
  if (!parsed.ok) {
    deps.err(parsed.error);
    deps.err('Run with --help for usage.');
    return 2;
  }
  if ('help' in parsed) {
    deps.out(USAGE);
    return 0;
  }
  const { args } = parsed;
  if (!deps.isInteractive()) {
    deps.err(
      'Run this in an interactive terminal: your password is only read from a hidden prompt.'
    );
    return 2;
  }
  let certificate: string | undefined;
  try {
    certificate = args.caFile
      ? await deps.readCertificate(args.caFile)
      : undefined;
  } catch {
    deps.err('Could not read the CA certificate file. Nothing was done.');
    return 2;
  }
  let password: string;
  try {
    password = await deps.promptHidden(`Password for ${args.user}: `);
  } catch {
    deps.err('Cancelled. Nothing was done.');
    return 2;
  }
  if (password.length === 0) {
    deps.err('No password entered. Nothing was done.');
    return 2;
  }
  let session: ApproverSession;
  try {
    session = await deps.connect(
      buildConnectionConfig(args, password, certificate)
    );
  } catch (error) {
    deps.err(
      error instanceof Error &&
        error.message === 'Signed in as a different login'
        ? 'The database signed you in as a different login. Nothing was done.'
        : 'Could not sign in to the database. Nothing was done.'
    );
    return 1;
  }

  try {
    if (args.request === undefined) {
      const rows = await session.listOpen();
      if (rows.length === 0) deps.out('No open requests are waiting for you.');
      for (const row of rows) {
        deps.out('');
        for (const line of describeRequest(row)) deps.out(line);
      }
      return 0;
    }
    return await decideOne(
      session,
      args.request,
      args.reject ? 'reject' : 'approve',
      args.commit,
      deps
    );
  } catch (error) {
    deps.err(
      error instanceof OpsRefusal
        ? refusalMessage(error.code)
        : 'The database could not complete the request. Nothing was recorded.'
    );
    return 1;
  } finally {
    await session.close();
  }
}

function processDeps(): ApproveDeps {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    isInteractive: () =>
      process.stdin.isTTY === true && process.stdout.isTTY === true,
    promptHidden: createHiddenPrompt(process.stdin, process.stdout),
    promptLine: createLinePrompt(process.stdin, process.stdout),
    readCertificate: (file) => readFile(file, 'utf8'),
    connect: (config) => openApproverSession(config),
  };
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2), processDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('Unexpected failure. Nothing was recorded.\n');
      process.exitCode = 1;
    }
  );
}
