import { Client } from 'pg';
import { PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS as statements } from './replay-accrual-observer-statements';
import { PIGGYVEST_ACCRUAL_REPLAY_STATEMENT } from './replay-accrual-statement';
import { replayAccrualObserverSchemas as schemas } from './schemas/replay-accrual-observer';

export async function createAccrualObserverPostgres(input: unknown) {
  const observer = schemas.observer.parse(input);
  const config = observer.database;
  const withConnection = async (
    readOnly: boolean,
    action: (client: Client) => Promise<{ rows: unknown }>
  ) => {
    schemas.observer.parse(observer);
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.role,
      password: config.password,
      ssl: { ca: config.ssl.ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
      statement_timeout: 8000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 12000,
      application_name: 'baci-staging-accrual-observer',
    });
    let disconnected = false;
    client.on('error', () => {
      disconnected = true;
    });
    try {
      await client.connect();
      await client.query(
        readOnly ? 'BEGIN READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED'
      );
      const session = schemas.sessionRows.parse(
        (await client.query(statements.session, [observer.executionDeadline]))
          .rows
      )[0];
      if (session.readOnly !== (readOnly ? 'on' : 'off'))
        throw new Error('Session refused');
      schemas.identityRows.parse(
        (await client.query(statements.identity)).rows
      );
      const authority = schemas.authorityRows.parse(
        (await client.query(statements.authority)).rows
      )[0];
      if (
        authority.wrapperDefinitionSha256 !==
          observer.wrapperDefinitionSha256 ||
        authority.originalDefinitionSha256 !==
          observer.originalDefinitionSha256 ||
        disconnected
      )
        throw new Error('Authority refused');
      const result = await action(client);
      schemas.observer.parse(observer);
      const completion = await client.query(readOnly ? 'ROLLBACK' : 'COMMIT');
      if (
        completion.command !== (readOnly ? 'ROLLBACK' : 'COMMIT') ||
        disconnected
      )
        throw new Error('Completion unconfirmed');
      return result;
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('Staging accrual observer database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
  await withConnection(true, async () => ({ rows: [] }));
  return async (
    statement: string,
    parameters: readonly string[]
  ): Promise<{ rows: unknown }> => {
    const parsed = schemas.parameters.safeParse(parameters);
    if (
      statement !== PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text ||
      !parsed.success ||
      parsed.data[0] !== config.integrationId ||
      parsed.data[1] !== config.businessId
    )
      throw new Error('Staging accrual observer database unavailable');
    return await withConnection(false, (client) =>
      client.query(statements.apply, parsed.data)
    );
  };
}
