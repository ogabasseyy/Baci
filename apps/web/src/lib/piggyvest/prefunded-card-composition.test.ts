import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardPostgresExecutorSchema } from '@/schemas/prefunded-card-postgres-executor';
import { createPrefundedCardComposition } from './prefunded-card-composition';
import { prefundedCardCompositionTestOptions as options } from './prefunded-card-composition.test-fixture';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS as customerStatements } from './prefunded-card-customer-statements';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  createExecution: vi.fn(),
  createReplay: vi.fn(),
  createAuthorizer: vi.fn(),
  worker: vi.fn(),
  evidence: vi.fn(),
  authorizer: vi.fn(),
  customer: vi.fn(),
  tick: vi.fn(),
  replay: vi.fn(),
  provision: vi.fn(),
}));
const unavailable = 'Prefunded composition unavailable';
vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: mocks.createExecutor,
}));
vi.mock('./prefunded-card-execution', () => ({
  createPrefundedCardExecution: mocks.createExecution,
}));
vi.mock('./prefunded-card-receipt-replay', () => ({
  createPrefundedCardReceiptReplay: mocks.createReplay,
}));
vi.mock('./prefunded-card-authorization-resolver', () => ({
  createPrefundedCardAuthorizationResolver: mocks.createAuthorizer,
}));

function customerParameters() {
  return [
    fixture.claim.integrationId,
    fixture.claim.merchantId,
    fixture.claim.customerId,
    fixture.claim.goalId,
    '90000000-0000-4000-8000-000000000001',
    fixture.claim.businessId,
    '123',
    JSON.stringify({
      goalId: fixture.claim.goalId,
      savedMethodId: '90000000-0000-4000-8000-000000000001',
      idempotencyKey: '90000000-0000-4000-8000-000000000001',
      amountKobo: 100,
      consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
    }),
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createExecutor.mockImplementation((input: unknown) => {
    const { profile } = prefundedCardPostgresExecutorSchema.parse(input);
    if (
      profile !== 'customer' &&
      profile !== 'worker' &&
      profile !== 'evidence' &&
      profile !== 'authorizer'
    )
      throw new Error('Unexpected profile');
    return mocks[profile];
  });
  mocks.createExecution.mockReturnValue(mocks.tick);
  mocks.createReplay.mockReturnValue(mocks.replay);
  mocks.createAuthorizer.mockReturnValue({ provision: mocks.provision });
  mocks.customer.mockResolvedValue({ rows: [] });
});

describe('createPrefundedCardComposition', () => {
  it('constructs fixed profiles without running SQL, providers or a tick', () => {
    const input = options();
    const runtime = createPrefundedCardComposition(input);
    expect(
      mocks.createExecutor.mock.calls.map(
        ([configuration]) =>
          prefundedCardPostgresExecutorSchema.parse(configuration).profile
      )
    ).toEqual(['worker', 'evidence', 'authorizer', 'customer']);
    for (const execute of [
      mocks.worker,
      mocks.evidence,
      mocks.authorizer,
      mocks.customer,
    ])
      expect(execute).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
    expect(mocks.tick).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(Object.keys(runtime.authorizer)).toEqual(['provision']);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(typeof runtime.resolveEnrollment).toBe('function');
    expect(runtime.customer).toMatchObject({
      enabled: true,
      expectedSystemId: '123',
    });
  });

  it('uses the worker catalog for verification reads and replay projection', () => {
    createPrefundedCardComposition(options());
    expect(mocks.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: mocks.worker,
        evidenceExecute: mocks.worker,
      })
    );
    expect(mocks.createReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionExecute: mocks.evidence,
        ledgerExecute: mocks.worker,
      })
    );
    expect(mocks.createAuthorizer).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: mocks.authorizer,
        scope: {
          integrationId: fixture.claim.integrationId,
          merchantId: fixture.claim.merchantId,
          treasuryBindingId: fixture.claim.treasuryBindingId,
          systemIdentifier: '123',
        },
      })
    );
  });

  it('projects worker scope and routes nullable real-bank hints only via the worker', async () => {
    const input = options();
    Reflect.set(input.configuration.worker, 'batchSize', 20);
    const runtime = createPrefundedCardComposition(input);
    const rawPayload = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'event',
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'inflow_transaction',
        customer_id: 'customer',
        pvb_wallet: 'outer-wallet',
        pvb_reference: 'reference',
        pvb_destination_wallet: null,
        pvb_third_party_reference: null,
        eventData: {
          customer_id: 'customer',
          destination_wallet_id: 'inner-wallet',
          type: 'inter',
          status: 'COMPLETED',
          category: 'bank_transfer_inflow',
          session_id: null,
        },
      })
    );
    mocks.worker.mockResolvedValue({ rows: [{ result: 'enrolled' }] });
    await expect(
      runtime.resolveEnrollment({
        rawPayload,
        receiptId: 'receipt',
        payloadSha256: createHash('sha256').update(rawPayload).digest('hex'),
        eventId: 'event',
        eventType: 'bank-transfer.inflow.success',
        providerCustomerId: 'customer',
      })
    ).resolves.toBe('enrolled');
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect(mocks.evidence).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it('passes worker signals, receipt bytes and provision requests unchanged', async () => {
    const runtime = createPrefundedCardComposition(options());
    const signal = new AbortController().signal;
    const receipt = { rawPayload: new Uint8Array([1]), signature: 'synthetic' };
    const provision = { merchantId: fixture.claim.merchantId };
    mocks.tick.mockResolvedValue({ claimed: 0 });
    mocks.replay.mockResolvedValue({ outcome: 'rejected' });
    mocks.provision.mockResolvedValue({ outcome: 'duplicate' });
    await expect(runtime.tick(signal)).resolves.toEqual({ claimed: 0 });
    await expect(runtime.replayReceipt(receipt)).resolves.toEqual({
      outcome: 'rejected',
    });
    await expect(runtime.authorizer.provision(provision)).resolves.toEqual({
      outcome: 'duplicate',
    });
    expect(mocks.tick).toHaveBeenCalledExactlyOnceWith(signal);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(mocks.provision).toHaveBeenCalledExactlyOnceWith(provision);
  });

  it.each([
    0, 1, 5, 6,
  ])('refuses customer scope mismatch at parameter %s before SQL', async (index) => {
    const runtime = createPrefundedCardComposition(options());
    const parameters = customerParameters();
    parameters[index] = 'another-scope';
    await expect(
      runtime.customer.execute(customerStatements.request, parameters)
    ).rejects.toThrow(unavailable);
    expect(mocks.customer).not.toHaveBeenCalled();
  });

  it('refuses worker statements and empty customer parameters before SQL', async () => {
    const runtime = createPrefundedCardComposition(options());
    await expect(
      runtime.customer.execute('SELECT 1', customerParameters())
    ).rejects.toThrow(unavailable);
    await expect(
      runtime.customer.execute(customerStatements.request, [])
    ).rejects.toThrow(unavailable);
    expect(mocks.customer).not.toHaveBeenCalled();
  });

  it('allows the exact scoped customer capability statement', async () => {
    const runtime = createPrefundedCardComposition(options());
    const parameters = customerParameters();
    await runtime.customer.execute(customerStatements.capabilities, parameters);
    expect(mocks.customer).toHaveBeenCalledExactlyOnceWith(
      customerStatements.capabilities,
      parameters
    );
  });

  it('keeps a parsed snapshot when the caller mutates its original configuration', async () => {
    const input = options();
    const runtime = createPrefundedCardComposition(input);
    input.configuration.worker.merchantId =
      '90000000-0000-4000-8000-000000000002';
    input.configuration.database.treasury.login = 'prefunded_evidence';
    input.configuration.provider.paystackSecret = 'sk_test_changed';
    await runtime.customer.execute(
      customerStatements.status,
      customerParameters()
    );
    expect(mocks.customer).toHaveBeenCalledExactlyOnceWith(
      customerStatements.status,
      customerParameters()
    );
    expect(
      mocks.createAuthorizer.mock.calls[0][0].verification.paystackSecret
    ).toBe(fixture.providerSettings.paystackSecret);
  });

  it('rejects mismatched configuration before constructing any capability', () => {
    const input = options();
    input.configuration.database.ingestion.expectedSystemId = '456';
    expect(() => createPrefundedCardComposition(input)).toThrow(unavailable);
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.createExecution).not.toHaveBeenCalled();
    expect(mocks.createReplay).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects request-selected profiles and missing fetch before construction', () => {
    for (const property of ['profile', 'allowedStatements']) {
      const input = options();
      Reflect.set(input.configuration.database.treasury, property, 'worker');
      expect(() => createPrefundedCardComposition(input)).toThrow(unavailable);
    }
    const input = options();
    Reflect.set(input, 'fetchImplementation', undefined);
    expect(() => createPrefundedCardComposition(input)).toThrow(unavailable);
    expect(mocks.createExecutor).not.toHaveBeenCalled();
  });

  it('redacts configuration and downstream failures across every capability', async () => {
    const input = options();
    const runtime = createPrefundedCardComposition(input);
    const secret = new Error('password=synthetic-secret provider-body');
    mocks.tick.mockRejectedValue(secret);
    mocks.replay.mockRejectedValue(secret);
    mocks.provision.mockRejectedValue(secret);
    mocks.customer.mockRejectedValue(secret);
    const operations = [
      () => runtime.tick(),
      () => runtime.replayReceipt({ rawPayload: null, signature: null }),
      () => runtime.authorizer.provision({}),
      () =>
        runtime.customer.execute(
          customerStatements.status,
          customerParameters()
        ),
    ];
    for (const operation of operations)
      await expect(operation()).rejects.toThrow(new Error(unavailable));
    mocks.createExecutor.mockImplementationOnce(() => {
      throw secret;
    });
    expect(() => createPrefundedCardComposition(input)).toThrow(
      new Error(unavailable)
    );
  });
});
