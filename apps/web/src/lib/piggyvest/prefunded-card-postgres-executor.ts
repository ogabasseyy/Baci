import 'server-only';
import { Client } from 'pg';

import {
  prefundedCardPostgresExecutorSchema,
  prefundedCardPostgresExecutorSchemas,
} from '@/schemas/prefunded-card-postgres-executor';
import { PrefundedCardPostgresFailure } from './prefunded-card-postgres-failure';
import { prefundedCardPostgresStatementsForProfile } from './prefunded-card-postgres-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

const settings = {
  deadlineMs: 5_000,
  connectTimeoutMs: 1_500,
  queryTimeoutMs: 2_500,
  startupOptions:
    '-c search_path=pg_catalog -c statement_timeout=2000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000 -c synchronous_commit=on',
  verifyIdentity: 'SELECT prefunded_card.executor_system_identity() AS result',
  verifySession:
    "SELECT current_database() AS database_name, current_user AS role_name, session_user AS login_role, login.rolsuper AS is_superuser, login.rolbypassrls AS bypasses_rls, login.rolcreaterole AS creates_role, login.rolcreatedb AS creates_database, login.rolreplication AS replicates, login.rolcanlogin AS can_login, login.rolinherit AS inherits_privileges, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('role_name', granted.rolname, 'admin_option', membership.admin_option, 'can_login', granted.rolcanlogin, 'is_superuser', granted.rolsuper, 'bypasses_rls', granted.rolbypassrls, 'creates_role', granted.rolcreaterole, 'creates_database', granted.rolcreatedb, 'replicates', granted.rolreplication)) FILTER (WHERE granted.oid IS NOT NULL), '[]'::jsonb) AS memberships, COALESCE(jsonb_agg(DISTINCT inherited.rolname) FILTER (WHERE inherited.oid IS NOT NULL), '[]'::jsonb) AS inherited_memberships, current_setting('fsync') AS fsync_enabled, current_setting('synchronous_commit') AS synchronous_commit, pg_is_in_recovery() AS is_replica FROM pg_catalog.pg_roles login LEFT JOIN pg_catalog.pg_auth_members membership ON membership.member = login.oid LEFT JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid LEFT JOIN pg_catalog.pg_auth_members nested ON nested.member = granted.oid LEFT JOIN pg_catalog.pg_roles inherited ON inherited.oid = nested.roleid WHERE login.rolname = current_user GROUP BY login.oid, login.rolsuper, login.rolbypassrls, login.rolcreaterole, login.rolcreatedb, login.rolreplication, login.rolcanlogin, login.rolinherit",
} as const;

const expectedMemberships = {
  customer: [
    'prefunded_card_authorization_reader',
    'prefunded_treasury_ledger_worker',
  ],
  worker: [
    'prefunded_card_authorization_reader',
    'prefunded_treasury_ledger_worker',
  ],
  authorizer: ['prefunded_card_authorization_provisioner'],
  checkout_customer: [
    'prefunded_card_authorization_reader',
    'prefunded_treasury_ledger_worker',
  ],
  checkout_authorizer: ['prefunded_card_authorization_provisioner'],
  evidence: [],
  reversal: [
    'prefunded_card_authorization_reader',
    'prefunded_treasury_ledger_worker',
  ],
} as const;

function hasExpectedMemberships(
  profile: keyof typeof expectedMemberships,
  memberships: readonly { role_name: string }[]
) {
  const actual = memberships.map((membership) => membership.role_name).sort();
  const expected = [...expectedMemberships[profile]].sort();
  return (
    actual.length === expected.length &&
    actual.every((role, index) => role === expected[index])
  );
}

export function createPrefundedCardPostgresExecutor(
  configuration: unknown
): PiggyvestProvisioningExecutor {
  const parsed = prefundedCardPostgresExecutorSchema.safeParse(configuration);
  if (!parsed.success)
    throw new PrefundedCardPostgresFailure('unknown', 'configuration');
  const config = parsed.data;
  const statements = prefundedCardPostgresStatementsForProfile(config.profile);

  return async (statement, parameters) => {
    const operation = statements.find((entry) => entry.text === statement);
    const inputs = operation
      ? operation.parameters.length === parameters.length
        ? operation.parameters.map((schema, index) =>
            schema.safeParse(parameters[index])
          )
        : []
      : [];
    if (
      !operation ||
      operation.parameters.length !== parameters.length ||
      inputs.length !== parameters.length ||
      inputs.some((input) => !input.success)
    ) {
      throw new PrefundedCardPostgresFailure(
        config.profile,
        'statement-validation'
      );
    }
    const values = inputs.map((input) => (input.success ? input.data : null));
    const client = new Client({
      host:
        config.transport === 'local_test'
          ? config.socketDirectory
          : config.host,
      user: config.login,
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
      application_name: 'baci-prefunded-card-staging',
      fallback_application_name: 'baci-prefunded-card-staging',
      connectionTimeoutMillis: settings.connectTimeoutMs,
      query_timeout: settings.queryTimeoutMs,
      statement_timeout: 2_000,
      lock_timeout: 1_000,
      idle_in_transaction_session_timeout: 3_000,
      client_encoding: 'UTF8',
    });
    let phase: ConstructorParameters<typeof PrefundedCardPostgresFailure>[1] =
      'connect';
    let cancelled = false;
    let failed = false;
    let connectionFailure: PrefundedCardPostgresFailure | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    client.on('error', (error: unknown) => {
      failed = true;
      connectionFailure = new PrefundedCardPostgresFailure(
        config.profile,
        phase,
        error
      );
    });
    const active = () => {
      if (cancelled || failed)
        throw (
          connectionFailure ??
          new PrefundedCardPostgresFailure(config.profile, phase)
        );
    };
    const execute = async () => {
      await client.connect();
      active();
      phase = 'begin';
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      phase = 'identity-query';
      const identityRows = (await client.query(settings.verifyIdentity)).rows;
      phase = 'identity-validation';
      const identity =
        prefundedCardPostgresExecutorSchemas.identity.parse(identityRows)[0]
          .result;
      if (
        identity.database !== config.database ||
        identity.login !== config.login ||
        identity.systemIdentifier !== config.expectedSystemId
      ) {
        throw new Error('Prefunded card database unavailable');
      }
      phase = 'session-query';
      const sessionRows = (await client.query(settings.verifySession)).rows;
      phase = 'session-validation';
      const session =
        prefundedCardPostgresExecutorSchemas.session.parse(sessionRows)[0];
      active();
      if (
        session.database_name !== config.database ||
        session.role_name !== config.login ||
        session.login_role !== config.login ||
        !hasExpectedMemberships(config.profile, session.memberships)
      )
        throw new Error('Prefunded card database unavailable');
      phase = 'operation';
      const queryResult = await client.query(statement, values);
      phase = 'result-validation';
      const result = prefundedCardPostgresExecutorSchemas.result.parse({
        rows: queryResult.rows,
        command: queryResult.command,
      });
      active();
      phase = 'commit';
      const committed = await client.query('COMMIT');
      active();
      phase = 'commit-validation';
      if (
        committed.command !== 'COMMIT' ||
        client.getTransactionStatus() !== 'I'
      ) {
        throw new Error('Prefunded card database unavailable');
      }
      return { rows: result.rows };
    };
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        cancelled = true;
        reject(new PrefundedCardPostgresFailure(config.profile, 'deadline'));
      }, settings.deadlineMs);
    });
    try {
      return await Promise.race([execute(), deadline]);
    } catch (error) {
      throw error instanceof PrefundedCardPostgresFailure
        ? error
        : new PrefundedCardPostgresFailure(config.profile, phase, error);
    } finally {
      cancelled = true;
      clearTimeout(timer);
      void client.end().catch(() => undefined);
    }
  };
}
