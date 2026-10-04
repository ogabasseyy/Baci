import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';
import { createPrefundedCardPostgresExecutor } from '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-executor';
import { PrefundedCardPostgresFailure } from '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure';
import { prefundedCardReadOperationDiagnosticSchemas as schemas } from '../../../apps/web/src/schemas/prefunded-card-read-operation-diagnostic';
import { prefundedCardRuntimeSchemas } from '../../../apps/web/src/schemas/prefunded-card-runtime';

export async function runPrefundedCardReadOperationCli({
  arguments: argumentsInput = process.argv.slice(2),
  writeLine = (line: string) => process.stdout.write(`${line}\n`),
}: {
  arguments?: readonly string[];
  writeLine?: (line: string) => unknown;
} = {}): Promise<number> {
  let stage: 'arguments' | 'configuration' | 'executor' | 'read-result' =
    'arguments';
  let report: ReturnType<typeof schemas.report.parse>;
  let exitCode = 1;
  const flags = {
    redacted: true as const,
    financialActionAttempted: false as const,
    newPaymentStarted: false as const,
  };
  try {
    const [configPath] = schemas.arguments.parse(argumentsInput);
    stage = 'configuration';
    const loaded = await readPrefundedCardActivationConfig(configPath);
    if (!loaded.ok) throw new Error();
    const configuration = loaded.configuration.background.database.treasury;
    if (
      configuration.transport !== 'tls' ||
      configuration.login !== schemas.pins.login ||
      configuration.expectedLogin !== schemas.pins.login ||
      configuration.expectedSystemId !== schemas.pins.systemIdentifier
    )
      throw new Error();
    stage = 'executor';
    const execute = createPrefundedCardPostgresExecutor({
      ...configuration,
      profile: 'worker',
    });
    const response = await execute(
      'SELECT prefunded_card.read_operation($1::uuid,$2::text) AS result',
      [schemas.pins.operationId, schemas.pins.systemIdentifier]
    );
    stage = 'read-result';
    const result = prefundedCardRuntimeSchemas.readRows.parse(response.rows)[0]
      .result;
    if (result.operationId !== schemas.pins.operationId) throw new Error();
    report = {
      ...flags,
      status: 'read-operation-validated',
      acquiresRowLocks: true,
    };
    exitCode = 0;
  } catch (error) {
    const safe =
      error instanceof PrefundedCardPostgresFailure
        ? schemas.diagnostic.safeParse(error.diagnostic)
        : undefined;
    report = {
      ...flags,
      status: 'read-operation-refused',
      stage,
      ...(safe?.success ? { diagnostic: safe.data } : {}),
    };
  }
  writeLine(JSON.stringify(schemas.report.parse(report)));
  return exitCode;
}

if (typeof require === 'function' && require.main === module) {
  void runPrefundedCardReadOperationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
