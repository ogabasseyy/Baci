import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { createPrimaryCardTransferConnection } from './primary-wallet-card-transfer-connection';
import { dispatchPrimaryCardProviderTransfer } from './primary-wallet-card-transfer-dispatch';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  state: 'ready',
  badCommand: false,
  badContext: false,
  failRecord: false,
}));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => undefined;
    query = mocks.query;
    end = async () => undefined;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks, {
    state: 'ready',
    badCommand: false,
    badContext: false,
    failRecord: false,
  });
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
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
    if (sql.includes('dispatch_context'))
      result = {
        ...fixture.context,
        businessId: mocks.badContext ? 'other' : fixture.context.businessId,
      };
    if (sql.includes('claim_transfer')) {
      result = { outcome: 'existing' };
      if (mocks.state === 'ready') {
        mocks.state = 'dispatching';
        result = {
          outcome: 'claimed',
          token: fixture.context.customerId,
          command: {
            ...fixture.command,
            destinationWalletId: mocks.badCommand
              ? 'wrong'
              : fixture.command.destinationWalletId,
          },
        };
      }
    }
    if (sql.includes('record_transfer')) {
      if (mocks.failRecord) throw new Error('storage lost');
      mocks.state = parameters.at(-1) === true ? 'submitted' : 'unknown';
      result = true;
    }
    return { rows: [{ result }] };
  });
});
describe('actual mocked HTTP primary transfer integration', () => {
  it('commits one claim before exact authenticated POST and never sends a second reference', async () => {
    const fetchImplementation = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(mocks.state).toBe('dispatching');
        expect(String(url)).toBe(
          'https://staging.piggyvest.business/api/v1/transfer/wallet'
        );
        expect(init).toMatchObject({
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${fixture.configuration.runtime.apiToken}`,
            'Content-Type': 'application/json',
          },
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          amount: fixture.context.amountKobo,
          source: fixture.context.sourceWalletId,
          destination: fixture.context.destinationWalletId,
          currency: 'NGN',
          reference: fixture.context.reference,
        });
        return Response.json({ status: true }, { status: 202 });
      }
    );
    const dispatch = (operationId: string) =>
      dispatchPrimaryCardProviderTransfer({
        operationId,
        environment: fixture.environment,
        fetchImplementation,
        now: () => fixture.now,
      });
    expect(await dispatch(fixture.context.operationId)).toBe('submitted');
    expect(await dispatch(fixture.context.operationId)).toBe('existing');
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(mocks.state).toBe('submitted');
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.includes('settle_custody'))
    ).toBe(false);
  });
  it.each([
    401, 403, 500, 302,
  ])('persists HTTP %s as unknown with no financial retry', async (status) => {
    const fetchImplementation = vi.fn(
      async () => new Response('{}', { status })
    );
    const dispatch = createPrimaryCardTransferConnection({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => fixture.now,
    });
    expect(await dispatch(fixture.context.operationId)).toBe('unknown');
    expect(mocks.state).toBe('unknown');
    expect(await dispatch(fixture.context.operationId)).toBe('existing');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
  it.each([
    'lost_after_send',
    'false_ack',
    'malformed_json',
  ])('retains ambiguous %s without redispatch', async (scenario) => {
    const fetchImplementation = vi.fn(async () => {
      if (scenario === 'lost_after_send')
        throw new Error('provider private data');
      return scenario === 'false_ack'
        ? Response.json({ status: false })
        : new Response('not json');
    });
    const dispatch = createPrimaryCardTransferConnection({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => fixture.now,
    });
    expect(await dispatch(fixture.context.operationId)).toBe('unknown');
    expect(await dispatch(fixture.context.operationId)).toBe('existing');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
  it('retains dispatching after lost database acknowledgement and recovery never repeats HTTP', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true })
    );
    mocks.failRecord = true;
    const dispatch = createPrimaryCardTransferConnection({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => fixture.now,
    });
    await expect(dispatch(fixture.context.operationId)).rejects.toThrow(
      'storage unavailable'
    );
    expect(mocks.state).toBe('dispatching');
    mocks.failRecord = false;
    expect(await dispatch(fixture.context.operationId)).toBe('existing');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
  it('rejects wrong context before claim and wrong destination after claim without HTTP', async () => {
    const fetchImplementation = vi.fn();
    const dispatch = createPrimaryCardTransferConnection({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => fixture.now,
    });
    mocks.badContext = true;
    await expect(dispatch(fixture.context.operationId)).rejects.toThrow(
      'ownership'
    );
    expect(mocks.state).toBe('ready');
    mocks.badContext = false;
    mocks.badCommand = true;
    expect(await dispatch(fixture.context.operationId)).toBe('unknown');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('binds production HTTP only to matching durable production context, never a token-only default', async () => {
    const policyBytes = JSON.stringify({
      ...fixture.policy,
      environment: 'production',
    });
    const configuration = {
      ...fixture.configuration,
      runtime: { ...fixture.configuration.runtime, environment: 'production' },
      policyBytes,
      policySignature: createHmac(
        'sha256',
        fixture.configuration.policyIssuerKey
      )
        .update(policyBytes)
        .digest('hex'),
    };
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: [
        {
          result: sql.includes('dispatch_context')
            ? { ...fixture.context, environment: 'production' }
            : sql.includes('claim_transfer')
              ? {
                  outcome: 'claimed',
                  token: fixture.context.customerId,
                  command: fixture.command,
                }
              : true,
          database_name: fixture.configuration.runtime.transfer.name,
          login_name: 'baci_primary_card_transfer',
          role_name: 'baci_primary_card_transfer',
          safe: true,
          tls: true,
        },
      ],
    }));
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ status: true }));
    expect(
      await createPrimaryCardTransferConnection({
        configuration,
        fetchImplementation,
        now: () => fixture.now,
      })(fixture.context.operationId)
    ).toBe('submitted');
    expect(fetchImplementation.mock.calls[0][0]).toBe(
      'https://api.piggyvest.business/api/v1/transfer/wallet'
    );
  });
});
