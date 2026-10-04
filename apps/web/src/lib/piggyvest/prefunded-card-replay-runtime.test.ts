import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardPostgresExecutorSchema } from '@/schemas/prefunded-card-postgres-executor';
import { createPrefundedCardReplayRuntime } from './prefunded-card-replay-runtime';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  createEnrollment: vi.fn(),
  createReplay: vi.fn(),
  worker: vi.fn(),
  ingestion: vi.fn(),
  enrollment: vi.fn(),
  replay: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: mocks.createExecutor,
}));
vi.mock('./prefunded-card-replay-enrollment', () => ({
  createPrefundedCardReplayEnrollment: mocks.createEnrollment,
}));
vi.mock('./prefunded-card-receipt-replay', () => ({
  createPrefundedCardReceiptReplay: mocks.createReplay,
}));

function options() {
  const database = (login: string) => ({
    environment: 'staging',
    transport: 'local_test',
    socketDirectory:
      '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
    database: 'prefunded_card_local',
    expectedDatabase: 'prefunded_card_local',
    expectedSystemId: '123',
    port: 55461,
    login,
    expectedLogin: login,
    password: 'synthetic-local-only',
  });
  const scope = {
    environment: 'staging',
    integrationId: '10000000-0000-4000-8000-000000000002',
    merchantId: '10000000-0000-4000-8000-000000000003',
    treasuryBindingId: '10000000-0000-4000-8000-000000000006',
    businessId: 'business_1',
    expectedSystemId: '123',
  };
  return {
    configuration: {
      scope,
      evidence: {
        integrationId: scope.integrationId,
        systemIdentifier: '123',
        webhookSecret: 'synthetic-webhook-secret',
        piggyvest: {
          apiSecret: 'synthetic-api-secret',
          expectedBusinessId: 'business_1',
        },
      },
      database: {
        treasury: database('prefunded_treasury_operator'),
        ingestion: database('prefunded_evidence'),
      },
    },
    expectedAppSystemId: '123',
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createExecutor.mockImplementation((configuration: unknown) => {
    const { profile } =
      prefundedCardPostgresExecutorSchema.parse(configuration);
    if (profile === 'worker') return mocks.worker;
    if (profile === 'evidence') return mocks.ingestion;
    throw new Error('Unexpected executor profile');
  });
  mocks.createEnrollment.mockReturnValue(mocks.enrollment);
  mocks.createReplay.mockReturnValue(mocks.replay);
  mocks.worker.mockResolvedValue({ rows: [{ result: true }] });
  mocks.ingestion.mockResolvedValue({ rows: [{ result: true }] });
});

describe('createPrefundedCardReplayRuntime', () => {
  it('probes only two fixed executors and exposes only receiver replay capabilities', async () => {
    const input = options();
    const runtime = await createPrefundedCardReplayRuntime(input);
    expect(Object.keys(runtime)).toEqual(['resolveEnrollment', 'replay']);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(
      mocks.createExecutor.mock.calls.map(
        ([configuration]) =>
          prefundedCardPostgresExecutorSchema.parse(configuration).profile
      )
    ).toEqual(['worker', 'evidence']);
    expect(mocks.worker).toHaveBeenCalledExactlyOnceWith(
      'SELECT true AS result',
      []
    );
    expect(mocks.ingestion).toHaveBeenCalledExactlyOnceWith(
      'SELECT true AS result',
      []
    );
    expect(mocks.enrollment).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it('uses the worker for enrollment and ledger reads, never the ingestion executor', async () => {
    const input = options();
    await createPrefundedCardReplayRuntime(input);
    expect(mocks.createEnrollment).toHaveBeenCalledExactlyOnceWith({
      configuration: {
        scope: input.configuration.scope,
        databaseName: 'prefunded_card_local',
      },
      execute: mocks.worker,
    });
    expect(mocks.createReplay).toHaveBeenCalledExactlyOnceWith({
      configuration: expect.objectContaining({
        ...input.configuration.evidence,
        piggyvest: expect.objectContaining(
          input.configuration.evidence.piggyvest
        ),
      }),
      ingestionExecute: mocks.ingestion,
      ledgerExecute: mocks.worker,
      fetchImplementation: input.fetchImplementation,
    });
  });

  it('preserves receipt metadata, original bytes, signature and replay outcomes', async () => {
    const runtime = await createPrefundedCardReplayRuntime(options());
    const rawPayload = new Uint8Array([123, 125]);
    const enrollment = {
      receiptId: 'receipt',
      payloadSha256: 'a'.repeat(64),
      eventId: 'event',
      eventType: 'bank-transfer.inflow.success',
      providerCustomerId: 'customer',
      rawPayload,
    };
    const receipt = { rawPayload, signature: 'original-signature' };
    for (const outcome of ['enrolled', 'legacy', 'deferred']) {
      mocks.enrollment.mockResolvedValue(outcome);
      await expect(runtime.resolveEnrollment(enrollment)).resolves.toBe(
        outcome
      );
    }
    mocks.replay.mockResolvedValue({ outcome: 'retry', stage: 'projection' });
    await expect(runtime.replay(receipt)).resolves.toEqual({
      outcome: 'retry',
      stage: 'projection',
    });
    expect(mocks.enrollment).toHaveBeenLastCalledWith(enrollment);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(mocks.replay.mock.calls[0][0].rawPayload).toBe(rawPayload);
  });

  it('refuses even internally consistent foreign systems before constructing any capability', async () => {
    const input = options();
    input.expectedAppSystemId = '456';
    await expect(createPrefundedCardReplayRuntime(input)).rejects.toThrow(
      new Error('Prefunded replay runtime unavailable')
    );
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
    expect(mocks.createReplay).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.ingestion).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects unexpected process capabilities and missing fetch before construction', async () => {
    for (const field of [
      'paystackSecret',
      'provider',
      'authorizer',
      'reader',
      'batchSize',
    ]) {
      const input = options();
      Reflect.set(input.configuration, field, 'unexpected-secret');
      await expect(createPrefundedCardReplayRuntime(input)).rejects.toThrow(
        new Error('Prefunded replay runtime unavailable')
      );
    }
    const input = options();
    Reflect.set(input, 'fetchImplementation', undefined);
    await expect(createPrefundedCardReplayRuntime(input)).rejects.toThrow(
      new Error('Prefunded replay runtime unavailable')
    );
    expect(mocks.createExecutor).not.toHaveBeenCalled();
  });

  it('snapshots caller configuration before awaiting readiness and later mutations', async () => {
    const input = options();
    const activation = createPrefundedCardReplayRuntime(input);
    input.configuration.scope.businessId = 'different-business';
    input.configuration.evidence.piggyvest.apiSecret = 'different-secret';
    input.configuration.database.treasury.login = 'different-login';
    await activation;
    expect(
      mocks.createEnrollment.mock.calls[0][0].configuration.scope.businessId
    ).toBe('business_1');
    expect(
      mocks.createReplay.mock.calls[0][0].configuration.piggyvest.apiSecret
    ).toBe('synthetic-api-secret');
    expect(mocks.createExecutor.mock.calls[0][0].login).toBe(
      'prefunded_treasury_operator'
    );
  });

  it('redacts constructor and replay failures and defers enrollment failures', async () => {
    const runtime = await createPrefundedCardReplayRuntime(options());
    const privateError = new Error('password=private-secret provider-response');
    mocks.enrollment.mockRejectedValue(privateError);
    mocks.replay.mockRejectedValue(privateError);
    await expect(runtime.resolveEnrollment({})).resolves.toBe('deferred');
    await expect(
      runtime.replay({ rawPayload: null, signature: null })
    ).rejects.toThrow(new Error('Prefunded replay runtime unavailable'));
    for (const createRuntime of [
      mocks.createExecutor,
      mocks.createEnrollment,
      mocks.createReplay,
    ]) {
      createRuntime.mockImplementationOnce(() => {
        throw privateError;
      });
      await expect(createPrefundedCardReplayRuntime(options())).rejects.toThrow(
        new Error('Prefunded replay runtime unavailable')
      );
    }
  });

  it('does not construct callbacks until both readiness probes have completed', async () => {
    const worker = Promise.withResolvers<{ rows: { result: true }[] }>();
    const ingestion = Promise.withResolvers<{ rows: { result: true }[] }>();
    mocks.worker.mockReturnValue(worker.promise);
    mocks.ingestion.mockReturnValue(ingestion.promise);
    const input = options();
    const activation = createPrefundedCardReplayRuntime(input);
    expect(mocks.worker).toHaveBeenCalledExactlyOnceWith(
      'SELECT true AS result',
      []
    );
    expect(mocks.ingestion).not.toHaveBeenCalled();
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
    expect(mocks.createReplay).not.toHaveBeenCalled();
    worker.resolve({ rows: [{ result: true }] });
    await worker.promise;
    expect(mocks.ingestion).toHaveBeenCalledExactlyOnceWith(
      'SELECT true AS result',
      []
    );
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
    expect(mocks.createReplay).not.toHaveBeenCalled();
    ingestion.resolve({ rows: [{ result: true }] });
    expect(Object.keys(await activation)).toEqual([
      'resolveEnrollment',
      'replay',
    ]);
    expect(input.fetchImplementation).not.toHaveBeenCalled();
    expect(mocks.enrollment).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it.each([
    'worker',
    'ingestion',
  ] as const)('rejects failed or malformed %s readiness without returning callbacks', async (role) => {
    const input = options();
    const results = [
      undefined,
      { rows: [] },
      { rows: [{ result: false }] },
      { rows: [{ result: true }, { result: true }] },
      { rows: [{ result: true, private: 'secret' }] },
    ];
    for (const result of results) {
      if (result === undefined)
        mocks[role].mockRejectedValueOnce(
          new Error('password=secret wrong database')
        );
      else mocks[role].mockResolvedValueOnce(result);
      await expect(createPrefundedCardReplayRuntime(input)).rejects.toThrow(
        new Error('Prefunded replay runtime unavailable')
      );
    }
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
    expect(mocks.createReplay).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
    for (const execute of [mocks.worker, mocks.ingestion])
      for (const call of execute.mock.calls)
        expect(call).toEqual(['SELECT true AS result', []]);
  });
});
