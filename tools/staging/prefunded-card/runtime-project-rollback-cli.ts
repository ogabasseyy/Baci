import { Client } from 'pg';
import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';
import { PrefundedCardPostgresFailure } from '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure';
import {
  prefundedCardPostgresExecutorSchemas as executorSchemas,
  prefundedCardPostgresExecutorSchema,
} from '../../../apps/web/src/schemas/prefunded-card-postgres-executor';
import { prefundedCardProjectRollbackDiagnosticSchemas as schemas } from '../../../apps/web/src/schemas/prefunded-card-project-rollback-diagnostic';
import { prefundedCardRuntimeSchemas } from '../../../apps/web/src/schemas/prefunded-card-runtime';

export async function runPrefundedCardProjectRollbackCli({
  arguments: argumentsInput = process.argv.slice(2),
  writeLine = (line: string) => process.stdout.write(`${line}\n`),
}: {
  arguments?: readonly string[];
  writeLine?: (line: string) => unknown;
} = {}): Promise<number> {
  let phase: ReturnType<typeof schemas.phase.parse> = 'arguments';
  let failure:
    | {
        profile: 'worker';
        phase: ReturnType<typeof schemas.phase.parse>;
        code: string;
      }
    | undefined;
  let client: Client | undefined;
  let socketError: unknown;
  let socketFailed = false;
  let rollbackConfirmed = false;
  let constraintsValidated = false;
  let connectionClosed = false;
  let outcome: 'applied' | 'duplicate' | 'deferred' | undefined;
  let budgetEnd = 0;
  const { pins, settings } = schemas;
  const fail = (error: unknown, failedPhase = phase) => {
    const safeCode = schemas.code.safeParse(
      error instanceof Error
        ? Object.getOwnPropertyDescriptor(error, 'code')?.value
        : undefined
    );
    failure ??= {
      profile: 'worker',
      phase: failedPhase,
      code: safeCode.success
        ? safeCode.data
        : new PrefundedCardPostgresFailure('worker', 'operation', error)
            .diagnostic.code,
    };
  };
  const bounded = async <Result>(pending: Promise<Result>): Promise<Result> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error()),
            Math.max(0, budgetEnd - Date.now())
          );
        }),
      ]);
    } catch (error) {
      if (Date.now() >= budgetEnd) fail(error, 'deadline');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const active = () => {
    if (Date.now() >= budgetEnd) {
      fail(undefined, 'deadline');
      throw new Error();
    }
    if (socketFailed) throw socketError;
  };
  try {
    const [configPath] = schemas.arguments.parse(argumentsInput);
    phase = 'configuration';
    const loaded = await readPrefundedCardActivationConfig(configPath);
    if (
      !loaded.ok ||
      loaded.configuration.expected.expiresAt !== pins.deadline ||
      Date.now() >= Date.parse(pins.deadline)
    )
      throw new Error();
    const config = prefundedCardPostgresExecutorSchema.parse({
      ...loaded.configuration.background.database.treasury,
      profile: 'worker',
    });
    if (
      config.transport !== 'tls' ||
      !config.certificateAuthority ||
      config.login !== pins.login ||
      config.expectedSystemId !== pins.systemIdentifier
    )
      throw new Error();
    budgetEnd = Math.min(
      Date.now() + settings.deadlineMs,
      Date.parse(pins.deadline)
    );
    phase = 'connect';
    client = new Client({
      host: config.host,
      user: config.login,
      database: config.database,
      port: config.port,
      password: config.password,
      ssl: { rejectUnauthorized: true, ca: config.certificateAuthority },
      options: settings.startupOptions,
      application_name: 'baci-prefunded-card-staging',
      fallback_application_name: 'baci-prefunded-card-staging',
      connectionTimeoutMillis: settings.connectTimeoutMs,
      query_timeout: settings.queryTimeoutMs,
      statement_timeout: 2000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 3000,
      client_encoding: 'UTF8',
    });
    client.on('error', (error: unknown) => {
      socketFailed = true;
      socketError = error;
    });
    await bounded(client.connect());
    active();
    phase = 'begin';
    const begun = await bounded(client.query(settings.begin));
    active();
    phase = 'begin-validation';
    if (begun.command !== 'BEGIN' || client.getTransactionStatus() !== 'T')
      throw new Error();
    phase = 'identity-query';
    const identityRows = await bounded(client.query(settings.identity));
    active();
    phase = 'identity-validation';
    const identity = executorSchemas.identity.parse(identityRows.rows)[0]
      .result;
    if (
      identity.database !== config.database ||
      identity.login !== config.login ||
      identity.systemIdentifier !== pins.systemIdentifier
    )
      throw new Error();
    phase = 'session-query';
    const sessionRows = await bounded(client.query(settings.session));
    active();
    phase = 'session-validation';
    const session = executorSchemas.session.parse(sessionRows.rows)[0];
    const memberships = session.memberships
      .map((member) => member.role_name)
      .sort();
    if (
      session.database_name !== config.database ||
      session.role_name !== pins.login ||
      session.login_role !== pins.login ||
      memberships.length !== settings.memberships.length ||
      memberships.some((name, index) => name !== settings.memberships[index])
    )
      throw new Error();
    active();
    phase = 'operation';
    const projected = await bounded(
      client.query(settings.project, [pins.operationId, pins.systemIdentifier])
    );
    active();
    phase = 'result-validation';
    const response = executorSchemas.result.parse({
      rows: projected.rows,
      command: projected.command,
    });
    outcome = prefundedCardRuntimeSchemas.projectionRows.parse(response.rows)[0]
      .result;
    if (client.getTransactionStatus() !== 'T') throw new Error();
    active();
    phase = 'constraints';
    const constraints = await bounded(client.query(settings.constraints));
    active();
    if (constraints.command !== 'SET') throw new Error();
    constraintsValidated = true;
  } catch (error) {
    fail(error);
  } finally {
    if (client) {
      phase = 'rollback';
      try {
        const rolledBack = await bounded(client.query(settings.rollback));
        phase = 'rollback-validation';
        if (
          rolledBack.command !== 'ROLLBACK' ||
          client.getTransactionStatus() !== 'I' ||
          socketFailed
        )
          fail(socketError ?? new Error());
        else {
          active();
          rollbackConfirmed = true;
        }
      } catch (error) {
        fail(error);
      }
      phase = 'close';
      try {
        await bounded(client.end());
        connectionClosed = true;
      } catch (error) {
        fail(error);
      }
    }
  }
  const flags = {
    redacted: true,
    financialCommitted: false,
    newPaymentStarted: false,
  } as const;
  const success =
    !failure &&
    outcome !== undefined &&
    constraintsValidated &&
    rollbackConfirmed &&
    connectionClosed;
  const report = schemas.report.parse(
    success
      ? {
          ...flags,
          status: 'project-rollback-validated',
          outcome,
          constraintsValidated,
          rollbackConfirmed,
          connectionClosed,
        }
      : {
          ...flags,
          status: 'project-rollback-refused',
          constraintsValidated,
          rollbackConfirmed,
          connectionClosed,
          diagnostic: failure,
        }
  );
  writeLine(JSON.stringify(report));
  return success ? 0 : 1;
}

if (typeof require === 'function' && require.main === module) {
  void runPrefundedCardProjectRollbackCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
