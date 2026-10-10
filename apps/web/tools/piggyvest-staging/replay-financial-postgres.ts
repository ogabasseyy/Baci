import { Client } from 'pg';
import { PIGGYVEST_ACCRUAL_REPLAY_STATEMENT } from './replay-accrual-statement';
import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';
import { replayFinancialSchemas } from './schemas/replay-financial';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';

const statements = new Map<string, number>(
  [
    PIGGYVEST_ACCRUAL_REPLAY_STATEMENT,
    PIGGYVEST_INTEREST_REPLAY_STATEMENT,
    ...Object.values(PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS),
  ].map((statement) => [statement.text, statement.parameters])
);

export function createFinancialReplayPostgres(configuration: unknown) {
  const config = replayFinancialSchemas.database.parse(configuration);
  return async (
    statement: string,
    parameters: readonly unknown[]
  ): Promise<{ rows: unknown[] }> => {
    if (
      (config.role === 'prefunded_treasury_operator' &&
        statement !== PIGGYVEST_INTEREST_REPLAY_STATEMENT.text) ||
      statements.get(statement) !== parameters.length ||
      !parameters.every(
        (value) =>
          typeof value === 'string' ||
          (typeof value === 'number' && Number.isSafeInteger(value))
      )
    ) {
      throw new Error('Financial replay database unavailable');
    }
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.role,
      password: config.password,
      ssl:
        config.role === 'prefunded_treasury_operator'
          ? { ca: config.ssl.ca, rejectUnauthorized: true }
          : undefined,
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
      statement_timeout: 8000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 12000,
      application_name: 'baci-staging-financial-replay',
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
      )
        throw new Error('Invalid session');
      const result = await client.query(statement, [...parameters]);
      const commit = await client.query('COMMIT');
      if (commit.command !== 'COMMIT' || disconnected)
        throw new Error('Commit unconfirmed');
      return { rows: result.rows };
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('Financial replay database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
