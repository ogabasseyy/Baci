import { Client } from 'pg';
import { transferSubmissionPostgresSchemas } from './schemas/transfer-submission-postgres';
import { PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS } from './transfer-outbox-submission-statements';

const statements = new Map<string, number>(
  Object.values(PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS).map((statement) => [
    statement.text,
    statement.parameters,
  ])
);

export function createTransferSubmissionPostgres(configuration: unknown) {
  const config =
    transferSubmissionPostgresSchemas.database.parse(configuration);
  return async (
    statement: string,
    parameters: readonly unknown[]
  ): Promise<{ rows: unknown[] }> => {
    const expectedParameters = statements.get(statement);
    const parsedParameters =
      transferSubmissionPostgresSchemas.parameters.safeParse(parameters);
    if (
      expectedParameters === undefined ||
      parsedParameters.success === false ||
      expectedParameters !== parsedParameters.data.length ||
      parsedParameters.data[0] !== config.expectedSystemId ||
      parsedParameters.data[12] !== config.businessId ||
      parsedParameters.data[13] !== config.integrationId
    ) {
      throw new Error('Transfer submission database unavailable');
    }

    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.role,
      password: config.password,
      ssl: false,
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
      statement_timeout: 8000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 12000,
      application_name: 'baci-staging-transfer-submission',
    });
    let disconnected = false;
    client.on('error', () => {
      disconnected = true;
    });
    try {
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const identity = await client.query(
        'SELECT session_user AS login, current_user AS role, current_database() AS database'
      );
      const session = identity.rows[0];
      if (
        identity.rows.length !== 1 ||
        session?.login !== config.role ||
        session.role !== config.role ||
        session.database !== config.database ||
        disconnected
      ) {
        throw new Error('Invalid session');
      }
      const result = await client.query(statement, [...parsedParameters.data]);
      const commit = await client.query('COMMIT');
      if (commit.command !== 'COMMIT' || disconnected) {
        throw new Error('Commit unconfirmed');
      }
      return { rows: result.rows };
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('Transfer submission database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
