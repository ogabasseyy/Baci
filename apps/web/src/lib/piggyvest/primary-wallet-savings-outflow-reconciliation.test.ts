import { beforeEach, expect, it, vi } from 'vitest';
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    query = mocks.query;
    end = mocks.end;
  },
}));
// The goal-cancel settle path re-reads the goal wallet at the provider; the
// answer is mocked so no test depends on the network.
const wallets = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: wallets.retrieve }));
beforeEach(() => {
  wallets.retrieve.mockResolvedValue({
    id: 'source',
    api_customer_id: 'source-customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  });
});
const operationId = '11111111-1111-4111-8111-111111111111';
const configuration = {
  integrationId: '22222222-2222-4222-8222-222222222222',
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
};
const reservation = {
  operationId,
  goalId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 2000,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  reference: 'pvb-save-reference',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};
function verifiedResponse(status: 'successful' | 'failed') {
  return new Response(
    JSON.stringify({
      status: true,
      data: {
        status,
        id: 'transaction',
        internal_reference: 'transaction',
        reference: 'provider-reference',
        third_party_reference: reservation.reference,
        amount: 2000,
        fee: 0,
        customer_id: 'source-customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
      },
    })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
});
function mockLookup(result: unknown) {
  mocks.query.mockImplementation(
    async (statement: string, parameters?: unknown[]) => ({
      rows: [
        {
          result: statement.includes('find_dispatched_savings_by_reference')
            ? parameters?.includes(reservation.reference)
              ? result
              : null
            : statement.includes('read_dispatched_savings')
              ? parameters?.includes(operationId)
                ? reservation
                : null
              : statement.includes('release_failed_savings')
                ? 'released'
                : 'confirmed',
          database_name: 'postgres',
          login_name: configuration.database.login,
          role_name: configuration.database.login,
          safe: true,
          tls: true,
        },
      ],
    })
  );
}
it('resolves unmatched when no dispatched operation carries the reference', async () => {
  mockLookup(null);
  const fetchImplementation = vi.fn();
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['pvb-save-unknown'],
      fetchImplementation,
    })
  ).toBe('unmatched');
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('skips malformed references instead of trapping the event in retries', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi.fn();
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['', 'x'.repeat(201)],
      fetchImplementation,
    })
  ).toBe('unmatched');
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('confirms a matched dispatched operation through the shared proof', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(verifiedResponse('successful'));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['unrelated-candidate', reservation.reference],
      fetchImplementation,
    })
  ).toBe('confirmed');
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
    `reference=${encodeURIComponent(reservation.reference)}`
  );
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      String(statement).includes('settle_savings')
    )
  ).toBe(true);
});
it('releases a matched operation the provider reports as failed', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(verifiedResponse('failed'));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
    })
  ).toBe('cancelled');
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      String(statement).includes('release_failed_savings')
    )
  ).toBe(true);
});
it('stays pending when the provider re-query cannot confirm', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(new Response('private detail', { status: 404 }));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
    })
  ).toBe('pending');
});

const cancelOperationId = '44444444-4444-4444-8444-444444444444';
const cancelReference = `pvb-cancel-${reservation.goalId}`;
const cancelReservation = {
  ...reservation,
  operationId: cancelOperationId,
  reference: cancelReference,
};
function mockGoalCancelLookup(fail = false) {
  mocks.query.mockImplementation(async (statement: string) => {
    const session = {
      database_name: 'postgres',
      login_name: configuration.database.login,
      role_name: configuration.database.login,
      safe: true,
      tls: true,
    };
    if (statement.includes('find_dispatched_goal_cancel_by_reference')) {
      if (fail) throw new Error('function does not exist');
      return {
        rows: [{ result: { operationId: cancelOperationId }, ...session }],
      };
    }
    const result = statement.includes('read_dispatched_goal_cancel')
      ? cancelReservation
      : statement.includes('settle_goal_cancel')
        ? 'confirmed'
        : null;
    return { rows: [{ result, ...session }] };
  });
}
it('settles a dispatched goal cancel named by the reference when no savings transfer matches', async () => {
  mockGoalCancelLookup();
  const fetchImplementation = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        data: {
          status: 'successful',
          id: 'transaction',
          internal_reference: 'transaction',
          reference: 'provider-reference',
          third_party_reference: cancelReference,
          amount: 2000,
          fee: 0,
          customer_id: 'source-customer',
          source_wallet: 'source',
          destination_wallet: 'destination',
        },
      })
    )
  );
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [cancelReference],
      fetchImplementation,
    })
  ).toBe('confirmed');
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      String(statement).includes('settle_goal_cancel')
    )
  ).toBe(true);
});
it('keeps a goal cancel reference retryable when its lookup fails', async () => {
  mockGoalCancelLookup(true);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [cancelReference],
      fetchImplementation: vi.fn(),
    })
  ).toBe('pending');
  expect(warn).toHaveBeenCalled();
  // The format string is a constant: the goal kind and the error text are
  // arguments, so an injected "%s" can never forge the log line.
  const [format, ...args] = warn.mock.calls[0] ?? [];
  expect(format).toBe('[PiggyVest Webhook] Goal %s reconciliation skipped:');
  expect(args).toHaveLength(2);
  warn.mockRestore();
});
it('does not fail a legacy outflow when the lookup fails for an unrelated reference', async () => {
  mockGoalCancelLookup(true);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['legacy-reference-1'],
      fetchImplementation: vi.fn(),
    })
  ).toBe('unmatched');
  warn.mockRestore();
});

const completeOperationId = '55555555-5555-4555-8555-555555555555';
const completeReference = `pvb-complete-${reservation.goalId}`;
function mockGoalCompleteLookup(options: { failComplete?: boolean } = {}) {
  mocks.query.mockImplementation(async (statement: string) => {
    const session = {
      database_name: 'postgres',
      login_name: configuration.database.login,
      role_name: configuration.database.login,
      safe: true,
      tls: true,
    };
    if (statement.includes('find_dispatched_goal_complete_by_reference')) {
      if (options.failComplete) throw new Error('function does not exist');
      return {
        rows: [{ result: { operationId: completeOperationId }, ...session }],
      };
    }
    const result = statement.includes('read_dispatched_goal_complete')
      ? {
          ...reservation,
          operationId: completeOperationId,
          reference: completeReference,
        }
      : statement.includes('settle_goal_complete')
        ? 'confirmed'
        : null;
    return { rows: [{ result, ...session }] };
  });
}
const successfulCompleteRecord = () =>
  new Response(
    JSON.stringify({
      status: true,
      data: {
        status: 'successful',
        id: 'transaction',
        internal_reference: 'transaction',
        reference: 'provider-reference',
        third_party_reference: completeReference,
        amount: 2000,
        fee: 0,
        customer_id: 'source-customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
      },
    })
  );

it('settles a dispatched goal complete named by the reference after cancel finds no match', async () => {
  mockGoalCompleteLookup();
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [completeReference],
      fetchImplementation: vi
        .fn()
        .mockImplementation(async () => successfulCompleteRecord()),
    })
  ).toBe('confirmed');
  const statements = mocks.query.mock.calls.map(([text]) => String(text));
  expect(statements.some((text) => text.includes('settle_goal_complete'))).toBe(
    true
  );
  expect(statements.some((text) => text.includes('settle_goal_cancel'))).toBe(
    false
  );
});

it('keeps a goal complete reference retryable when its lookup fails', async () => {
  mockGoalCompleteLookup({ failComplete: true });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [completeReference],
      fetchImplementation: vi.fn(),
    })
  ).toBe('pending');
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('still reaches the goal complete lookup when the cancel lookup fails', async () => {
  mocks.query.mockImplementation(async (statement: string) => {
    const session = {
      database_name: 'postgres',
      login_name: configuration.database.login,
      role_name: configuration.database.login,
      safe: true,
      tls: true,
    };
    if (statement.includes('find_dispatched_goal_cancel_by_reference'))
      throw new Error('cancel lookup down');
    if (statement.includes('find_dispatched_goal_complete_by_reference'))
      return { rows: [{ result: null, ...session }] };
    return { rows: [{ result: null, ...session }] };
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['legacy-reference-2'],
      fetchImplementation: vi.fn(),
    })
  ).toBe('unmatched');
  expect(
    mocks.query.mock.calls.some(([text]) =>
      String(text).includes('find_dispatched_goal_complete_by_reference')
    )
  ).toBe(true);
  warn.mockRestore();
});
