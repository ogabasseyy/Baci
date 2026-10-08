import 'server-only';
import { Client } from 'pg';
import { savingsExitEvidenceSchemas as schemas } from '@/schemas/savings-exit-evidence';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { SAVINGS_EXIT_EVIDENCE_STATEMENTS as statements } from './savings-exit-evidence-statements';

export function createSavingsExitEvidenceStore(
  input: unknown
): PiggyvestProvisioningExecutor {
  const configuration = schemas.localStoreConfiguration.parse(input);
  return async (statement, parameters) => {
    if (
      statement !== statements.exitRecordEvidence.text ||
      parameters.length !== 2 ||
      parameters[0] !== configuration.integrationId ||
      typeof parameters[1] !== 'string'
    )
      throw new Error('Exit evidence statement denied');
    const receipt = schemas.receipt.parse(JSON.parse(parameters[1]));
    const client = new Client({
      host: configuration.socketDirectory,
      port: configuration.port,
      database: 'piggyvest_local',
      user: 'piggyvest_exit_evidence_writer',
      password: 'synthetic-local-only',
      ssl: false,
      application_name: 'baci-exit-evidence',
      connectionTimeoutMillis: 2000,
      query_timeout: 3000,
      statement_timeout: 2000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 3000,
      options: '-c search_path=pg_catalog',
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(statement, [
        configuration.integrationId,
        JSON.stringify(receipt),
      ]);
      const rows = schemas.storedRows.parse(result.rows);
      await client.query('COMMIT');
      return { rows };
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('Exit evidence storage unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
