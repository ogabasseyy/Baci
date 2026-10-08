import 'server-only';
import { Pool } from 'pg';
import {
  prefundedCardTreasurySnapshotConfigSchema,
  prefundedCardTreasurySnapshotStoreSchemas as schemas,
} from '@/schemas/prefunded-card-treasury-snapshot-config';
import type {
  PrefundedTreasurySnapshotInput,
  PrefundedTreasurySnapshotStore,
} from './prefunded-card-treasury-verifier';

const CONNECTION_TIMEOUT_MS = 1_500;
const QUERY_TIMEOUT_MS = 2_500;
const QUERY_OPTIONS =
  '-c search_path=pg_catalog -c statement_timeout=2000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000 -c synchronous_commit=on';
const unavailable = () =>
  new Error('Prefunded card treasury snapshot store unavailable');

const statements = {
  verifyBinding:
    'SELECT prefunded_card.verify_snapshot_binding($1::uuid, $2::text, $3::text, $4::text) AS result',
  databaseTime:
    'SELECT prefunded_card.snapshot_database_time($1::uuid) AS result',
  recordSnapshot:
    'SELECT prefunded_card.record_scoped_treasury_snapshot($1::uuid, $2::text, $3::timestamptz, $4::bigint) AS result',
} as const;

export function createPrefundedCardTreasurySnapshotStore(
  rawConfiguration: unknown
): {
  store: PrefundedTreasurySnapshotStore;
  close(): Promise<void>;
} {
  const parsed =
    prefundedCardTreasurySnapshotConfigSchema.safeParse(rawConfiguration);
  if (!parsed.success) throw unavailable();
  const { verifier, database } = parsed.data;

  let pool: Pool;
  try {
    pool = new Pool({
      host: database.host,
      user: database.login,
      database: database.database,
      port: database.port,
      password: database.password,
      ssl: {
        ca: database.certificateAuthority,
        servername: database.host,
        rejectUnauthorized: true,
      },
      options: QUERY_OPTIONS,
      application_name: 'baci-prefunded-card-snapshot-verifier',
      fallback_application_name: 'baci-prefunded-card-snapshot-verifier',
      max: 1,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      statement_timeout: 2_000,
      lock_timeout: 1_000,
      idle_in_transaction_session_timeout: 3_000,
      client_encoding: 'UTF8',
    });
  } catch {
    throw unavailable();
  }

  const pinnedScope = {
    environment: verifier.environment,
    systemIdentifier: verifier.systemIdentifier,
    treasuryBindingId: verifier.treasuryBindingId,
    expectedBusinessId: verifier.expectedBusinessId,
    sourceWalletId: verifier.sourceWalletId,
  };
  let failed = false;
  let closed = false;
  pool.on('error', () => {
    failed = true;
  });

  async function query<T>(
    statement: string,
    parameters: readonly (string | number)[],
    parseRows: (rows: unknown) => T
  ): Promise<T> {
    if (failed || closed) throw unavailable();
    try {
      const result = await pool.query(statement, [...parameters]);
      if (failed || closed) throw unavailable();
      return parseRows(result.rows);
    } catch {
      throw unavailable();
    }
  }

  async function assertBinding() {
    const rows = await query(
      statements.verifyBinding,
      [
        pinnedScope.treasuryBindingId,
        pinnedScope.systemIdentifier,
        pinnedScope.expectedBusinessId,
        pinnedScope.sourceWalletId,
      ],
      (value) => schemas.verificationRows.parse(value)
    );
    if (rows[0].result !== 'verified') throw unavailable();
  }

  const store: PrefundedTreasurySnapshotStore = {
    async verifyTreasuryBinding(input) {
      const scope = schemas.scope.safeParse(input);
      if (
        !scope.success ||
        scope.data.environment !== pinnedScope.environment ||
        scope.data.systemIdentifier !== pinnedScope.systemIdentifier ||
        scope.data.treasuryBindingId !== pinnedScope.treasuryBindingId ||
        scope.data.expectedBusinessId !== pinnedScope.expectedBusinessId ||
        scope.data.sourceWalletId !== pinnedScope.sourceWalletId
      )
        throw unavailable();
      const rows = await query(
        statements.verifyBinding,
        [
          scope.data.treasuryBindingId,
          scope.data.systemIdentifier,
          scope.data.expectedBusinessId,
          scope.data.sourceWalletId,
        ],
        (value) => schemas.verificationRows.parse(value)
      );
      return rows[0].result === 'verified' ? 'verified' : 'unverified';
    },
    async readDatabaseTime(treasuryBindingId) {
      const bindingId = schemas.bindingId.safeParse(treasuryBindingId);
      if (
        !bindingId.success ||
        bindingId.data !== pinnedScope.treasuryBindingId
      )
        throw unavailable();
      await assertBinding();
      const rows = await query(
        statements.databaseTime,
        [bindingId.data],
        (value) => schemas.databaseTimeRows.parse(value)
      );
      return rows[0].result;
    },
    async recordImmutableSnapshotWithDatabaseAssignedSequence(
      input: PrefundedTreasurySnapshotInput
    ) {
      const snapshot = schemas.snapshot.safeParse(input);
      if (
        !snapshot.success ||
        snapshot.data.treasuryBindingId !== pinnedScope.treasuryBindingId
      )
        throw unavailable();
      await assertBinding();
      const rows = await query(
        statements.recordSnapshot,
        [
          snapshot.data.treasuryBindingId,
          snapshot.data.evidenceId,
          snapshot.data.observedAt,
          String(snapshot.data.availableKobo),
        ],
        (value) => schemas.recordRows.parse(value)
      );
      return rows[0].result;
    },
  };

  return {
    store,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await pool.end();
      } catch {
        throw unavailable();
      }
    },
  };
}
