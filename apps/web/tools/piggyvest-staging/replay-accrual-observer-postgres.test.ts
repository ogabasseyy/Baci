import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(configuration: unknown) {
      state.construct(configuration);
    }
    connect = state.connect;
    query = state.query;
    end = state.end;
    on() {
      return this;
    }
  },
}));

import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { createAccrualObserverPostgres } from './replay-accrual-observer-postgres';
import { PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS as statements } from './replay-accrual-observer-statements';
import { PIGGYVEST_ACCRUAL_REPLAY_STATEMENT } from './replay-accrual-statement';

let sample: ReturnType<typeof createAccrualObserverTestFixture>;
let readOnly: boolean;
let tampered: boolean;

beforeEach(() => {
  // Observer schemas pin a fixed execution deadline with a Date.now()
  // expiry refine: freeze before it so happy-path tests stay green
  // regardless of wall-clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:00Z'));
  vi.clearAllMocks();
  sample = createAccrualObserverTestFixture();
  readOnly = true;
  tampered = false;
  state.connect.mockResolvedValue(undefined);
  state.end.mockResolvedValue(undefined);
  state.query.mockImplementation((sql: string) => {
    if (sql.startsWith('BEGIN')) readOnly = sql === 'BEGIN READ ONLY';
    let rows: unknown[] = [];
    if (sql === statements.session)
      rows = [
        {
          login: 'piggyvest_staging_ledger_worker',
          role: 'piggyvest_staging_ledger_worker',
          database: 'postgres',
          readOnly: readOnly ? 'on' : 'off',
          tls: true,
          unsafe: false,
          expiresValid: true,
          noMembership: true,
        },
      ];
    if (sql === statements.identity)
      rows = [
        {
          result: {
            login: 'piggyvest_staging_ledger_worker',
            database: 'postgres',
            systemIdentifier: sample.configuration.appSystemId,
          },
        },
      ];
    if (sql === statements.authority)
      rows = [
        {
          authorized: true,
          restricted: true,
          wrapperDefinitionSha256: tampered
            ? 'c'.repeat(64)
            : sample.observer.wrapperDefinitionSha256,
          originalDefinitionSha256: sample.observer.originalDefinitionSha256,
        },
      ];
    if (sql === statements.apply) rows = [{ result: 'applied' }];
    return Promise.resolve({
      rows,
      command: ['COMMIT', 'ROLLBACK'].includes(sql) ? sql : undefined,
    });
  });
});
afterEach(() => vi.useRealTimers());

function parameters() {
  return [
    sample.scope.integrationId,
    sample.scope.businessId,
    sample.configuration.appSystemId,
    sample.rows[3].receipt_id,
    sample.rows[3].payload_sha256,
    sample.raw.toString('utf8'),
  ];
}

it('preflights without observation writes and maps only the existing accrual call to its guarded wrapper', async () => {
  const execute = await createAccrualObserverPostgres(sample.observer);
  expect(state.query).not.toHaveBeenCalledWith(
    statements.apply,
    expect.anything()
  );
  expect(state.query).toHaveBeenCalledWith('BEGIN READ ONLY');
  expect(state.query).toHaveBeenCalledWith('ROLLBACK');
  await expect(
    execute(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text, parameters())
  ).resolves.toEqual({ rows: [{ result: 'applied' }], command: undefined });
  expect(state.query).toHaveBeenCalledWith(statements.apply, parameters());
  expect(state.query).toHaveBeenCalledWith(
    'BEGIN ISOLATION LEVEL READ COMMITTED'
  );
  expect(state.query).toHaveBeenCalledWith('COMMIT');
  expect(state.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      user: 'piggyvest_staging_ledger_worker',
      ssl: { ca: 'synthetic-ca', rejectUnauthorized: true },
    })
  );
});

it('refuses credit SQL, foreign scope and invalid raw parameters without opening another connection', async () => {
  const execute = await createAccrualObserverPostgres(sample.observer);
  state.construct.mockClear();
  for (const [sql, values] of [
    ['SELECT piggyvest_savings_ledger.apply()', parameters()],
    [
      PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text,
      ['40000000-0000-4000-8000-000000000009', ...parameters().slice(1)],
    ],
    [PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text, parameters().slice(0, 5)],
    [
      PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text,
      [...parameters().slice(0, 5), 'x'.repeat(65537)],
    ],
  ] as const)
    await expect(execute(sql, values)).rejects.toThrow(
      'Staging accrual observer database unavailable'
    );
  expect(state.construct).not.toHaveBeenCalled();
});

it('rechecks definition pins on every write and rolls back without invoking a changed wrapper', async () => {
  const execute = await createAccrualObserverPostgres(sample.observer);
  tampered = true;
  await expect(
    execute(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text, parameters())
  ).rejects.toThrow('Staging accrual observer database unavailable');
  expect(state.query).not.toHaveBeenCalledWith(
    statements.apply,
    expect.anything()
  );
  expect(state.query).not.toHaveBeenCalledWith('COMMIT');
});

it('refuses an already constructed executor after the fixed expiry', async () => {
  const execute = await createAccrualObserverPostgres(sample.observer);
  state.construct.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:10Z'));
  await expect(
    execute(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text, parameters())
  ).rejects.toThrow();
  expect(state.construct).not.toHaveBeenCalled();
});
