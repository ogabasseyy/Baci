import 'server-only';
import { isUint8Array } from 'node:util/types';
import { Client } from 'pg';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { piggyvestPostgresExecutionSchemas } from '@/schemas/piggyvest-postgres-execution';
import { PIGGYVEST_POSTGRES_EXECUTOR as settings } from './postgres-executor.constants';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPiggyvestPostgresExecutor(
  configuration: unknown
): PiggyvestProvisioningExecutor {
  const parsed = piggyvestPostgresConfigurationSchema.safeParse(configuration);
  if (!parsed.success) throw new Error('PiggyVest database unavailable');
  const config = parsed.data;

  return async (statement, parameters) => {
    const operation = Object.values(PIGGYVEST_POSTGRES_STATEMENTS).find(
      (entry) => entry.text === statement
    );
    const inputs =
      piggyvestPostgresExecutionSchemas.parameters.safeParse(parameters);
    if (
      !operation ||
      !inputs.success ||
      inputs.data.length !== operation.parameters ||
      !operation.roles.some((role) => role === config.role)
    ) {
      throw new Error('PiggyVest database unavailable');
    }
    const values = inputs.data.map((value) =>
      isUint8Array(value) ? Buffer.from(value) : value
    );
    let client: Client;
    try {
      client = new Client({
        host:
          config.transport === 'local_test'
            ? config.socketDirectory
            : config.host,
        user: config.role,
        database: config.database,
        port: config.port,
        password: config.password,
        ssl:
          config.transport === 'local_test'
            ? false
            : {
                rejectUnauthorized: true,
                ...(config.certificateAuthority
                  ? { ca: config.certificateAuthority }
                  : {}),
              },
        options: settings.startupOptions,
        application_name: 'baci-piggyvest-staging',
        fallback_application_name: 'baci-piggyvest-staging',
        connectionTimeoutMillis: settings.connectTimeoutMs,
        query_timeout: settings.queryTimeoutMs,
        statement_timeout: 2000,
        lock_timeout: 1000,
        idle_in_transaction_session_timeout: 3000,
        client_encoding: 'UTF8',
      });
    } catch {
      throw new Error('PiggyVest database unavailable');
    }
    let cancelled = false;
    let connectionFailed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    client.on('error', () => {
      connectionFailed = true;
    });
    const checkActive = () => {
      if (cancelled || connectionFailed)
        throw new Error('PiggyVest database unavailable');
    };
    const execute = async () => {
      await client.connect();
      checkActive();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      checkActive();
      const verification = await client.query(settings.verifySession);
      checkActive();
      const session = piggyvestPostgresExecutionSchemas.session.parse(
        verification.rows
      )[0];
      if (
        session.database_name !== config.database ||
        session.role_name !== config.role ||
        session.login_role !== config.role
      ) {
        throw new Error('PiggyVest database unavailable');
      }
      const result = await client.query(statement, values);
      checkActive();
      const projected = piggyvestPostgresExecutionSchemas.result.parse(result);
      const committed = await client.query('COMMIT');
      checkActive();
      if (
        committed.command !== 'COMMIT' ||
        client.getTransactionStatus() !== 'I'
      ) {
        throw new Error('PiggyVest database unavailable');
      }
      return { rows: projected.rows };
    };
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        cancelled = true;
        reject(new Error('PiggyVest database unavailable'));
      }, settings.deadlineMs);
    });
    try {
      return await Promise.race([execute(), deadline]);
    } catch {
      throw new Error('PiggyVest database unavailable');
    } finally {
      cancelled = true;
      clearTimeout(timeout);
      void client.end().catch(() => undefined);
    }
  };
}
