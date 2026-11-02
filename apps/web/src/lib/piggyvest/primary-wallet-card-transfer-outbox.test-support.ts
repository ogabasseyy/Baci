import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';

/**
 * In-memory twin of the card transfer outbox storage the worker reaches
 * through `pg`: session verification, ready-work selection, dispatch
 * context, claim and record. Each test file owns its `vi.mock('pg')` and
 * passes its hoisted state here, so the twin mutates that state.
 */
export interface OutboxDatabaseState {
  state: string;
  failRecord: boolean;
  invalid: boolean;
  stuckSibling: boolean;
}

export function freshOutboxDatabaseState(): OutboxDatabaseState {
  return {
    state: 'ready',
    failRecord: false,
    invalid: false,
    stuckSibling: false,
  };
}

export function outboxDatabaseQuery(database: OutboxDatabaseState) {
  // Asynchronous like pg: a storage failure rejects instead of throwing.
  return (sql: string, parameters: unknown[]) =>
    new Promise<{ rows: unknown[] }>((resolve) =>
      resolve(respond(database, sql, parameters))
    );
}

function respond(
  database: OutboxDatabaseState,
  sql: string,
  parameters: unknown[]
): { rows: unknown[] } {
  if (sql.includes('SESSION_USER AS'))
    return {
      rows: [
        {
          database_name: fixture.configuration.runtime.transfer.name,
          login_name: 'baci_primary_card_transfer',
          role_name: 'baci_primary_card_transfer',
          safe: true,
          tls: true,
        },
      ],
    };
  let result: unknown;
  if (sql.includes('select_ready_transfers'))
    result = {
      operationIds: database.invalid
        ? ['invalid']
        : parameters.at(-1) === '1' &&
            (database.state === 'ready' || database.stuckSibling)
          ? [fixture.context.operationId]
          : [],
      unknownCount:
        database.state === 'unknown' || database.stuckSibling ? 1 : 0,
      dispatchingCount: database.state === 'dispatching' ? 1 : 0,
    };
  if (sql.includes('dispatch_context')) result = fixture.context;
  if (sql.includes('claim_transfer')) {
    result = { outcome: 'existing' };
    if (database.state === 'ready') {
      database.state = 'dispatching';
      result = {
        outcome: 'claimed',
        token: fixture.context.customerId,
        command: fixture.command,
      };
    }
  }
  if (sql.includes('record_transfer')) {
    if (database.failRecord) throw new Error('private storage detail');
    database.state = parameters.at(-1) ? 'submitted' : 'unknown';
    result = true;
  }
  return { rows: [{ result }] };
}
