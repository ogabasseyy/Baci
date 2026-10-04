interface CommandHandlers {
  check: () => Promise<unknown>;
  pass: () => Promise<void>;
  daemon: () => Promise<void>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const readyReport = JSON.stringify({
  status: 'replay-runtime-ready',
  readOnly: true,
});
const invalidReport = JSON.stringify({
  status: 'replay-runtime-invalid-command',
  readOnly: true,
});
const allowedFailureStages = new Set([
  'configuration',
  'financial-database',
  'interest-authority',
  'prefunded-runtime',
  'receipt-database',
  'app-database',
]);

function failureReport(stage: string): string {
  return `${JSON.stringify({
    status: 'replay-runtime-not-ready',
    readOnly: true,
    stage,
  })}\n`;
}

export async function runReplayDaemonCommand(
  arguments_: string[],
  handlers: CommandHandlers
): Promise<number> {
  if (arguments_.length === 0) {
    try {
      await handlers.daemon();
      return 0;
    } catch {
      handlers.stderr('{"replay":"daemon-failed"}\n');
      return 1;
    }
  }
  if (arguments_.length === 1 && arguments_[0] === '--pass') {
    try {
      await handlers.pass();
      return 0;
    } catch {
      return 1;
    }
  }
  if (arguments_.length === 1 && arguments_[0] === '--check') {
    try {
      const result = await handlers.check();
      if (typeof result === 'object' && result !== null && 'ready' in result) {
        if (result.ready === true) {
          handlers.stdout(`${readyReport}\n`);
          return 0;
        }
        if (
          result.ready === false &&
          'stage' in result &&
          typeof result.stage === 'string' &&
          allowedFailureStages.has(result.stage)
        ) {
          handlers.stderr(failureReport(result.stage));
          return 1;
        }
      }
    } catch {
      handlers.stderr(failureReport('readiness'));
      return 1;
    }
    handlers.stderr(failureReport('readiness'));
    return 1;
  }
  handlers.stderr(`${invalidReport}\n`);
  return 1;
}
