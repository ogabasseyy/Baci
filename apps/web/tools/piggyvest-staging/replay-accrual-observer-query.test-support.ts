import type { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS as statements } from './replay-accrual-observer-statements';
import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';

export function accrualObserverQueryResponse(input: {
  sample: ReturnType<typeof createAccrualObserverTestFixture>;
  role: string;
  sql: string;
  parameters?: readonly string[];
  readOnly: boolean;
  failure: string;
  observations: Set<string>;
  paid: Set<string>;
}) {
  const { sample, role, sql, parameters, readOnly, failure } = input;
  const observer = role === 'piggyvest_staging_ledger_worker';
  const row = (value: unknown) => ({ rows: [value] });
  if (sql.startsWith('SELECT session_user'))
    return row({
      login: role,
      role,
      database: 'postgres',
      unsafe: false,
      ...(observer
        ? {
            readOnly: readOnly ? 'on' : 'off',
            tls: failure !== 'tls',
            expiresValid: failure !== 'expired',
            noMembership: failure !== 'membership',
          }
        : { read_only: 'on', ssl: true }),
    });
  if (sql === statements.identity)
    return row({
      result: {
        systemIdentifier:
          observer && failure === 'identity'
            ? '1'
            : sample.configuration.appSystemId,
        login: role,
        database: 'postgres',
      },
    });
  if (sql.includes('has_function_privilege'))
    return row(
      observer
        ? {
            authorized: failure !== 'authority',
            restricted: failure !== 'broad',
            wrapperDefinitionSha256:
              failure === 'pin'
                ? 'c'.repeat(64)
                : sample.observer.wrapperDefinitionSha256,
            originalDefinitionSha256: sample.observer.originalDefinitionSha256,
          }
        : { authorized: true }
    );
  const records =
    sql === statements.apply
      ? input.observations
      : sql === PIGGYVEST_INTEREST_REPLAY_STATEMENT.text
        ? input.paid
        : undefined;
  if (records) {
    const key = parameters?.[4] ?? '';
    const result = records.has(key) ? 'duplicate' : 'applied';
    records.add(key);
    return row({ result });
  }
  return {
    rows: [],
    command: ['COMMIT', 'ROLLBACK'].includes(sql) ? sql : undefined,
  };
}
