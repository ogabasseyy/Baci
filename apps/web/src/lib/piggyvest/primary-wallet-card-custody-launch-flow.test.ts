import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { runPrimaryCardCustodyLaunch } from './primary-wallet-card-custody-launch';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => undefined;
    query = mocks.query;
    end = async () => undefined;
  },
}));
const bytes = Buffer.from(
  JSON.stringify({
    deliveryContract: 'approved-primary-card-crosswalk-file-v1',
    integrationId: fixture.context.integrationId,
    environment: 'staging',
    expiresAt: fixture.configuration.expiresAt,
    records: [
      {
        operationId: fixture.context.operationId,
        crosswalk: fixture.crosswalk,
      },
    ],
  })
);
const issuerKey = 'mock-reviewed-internal-issuer-000000';
const environment = {
  ...fixture.environment,
  PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: undefined,
  PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined,
  PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: '1',
  PIGGYVEST_PRIMARY_CARD_WORKER_APPROVED: 'true',
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE: '/fixture/binding.json',
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SHA256: createHash('sha256')
    .update(bytes)
    .digest('hex'),
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SIGNATURE: createHmac(
    'sha256',
    issuerKey
  )
    .update(bytes)
    .digest('hex'),
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_DELIVERY_KEY: issuerKey,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SESSION_USER AS'))
      return {
        rows: [
          {
            database_name: fixture.configuration.custody.name,
            login_name: 'baci_primary_card_custody',
            role_name: 'baci_primary_card_custody',
            safe: true,
            tls: true,
          },
        ],
      };
    let result: unknown = true;
    if (sql.includes('signed_inbox_readiness')) result = fixture.ready;
    if (sql.includes('claim_signed_inbox')) result = [fixture.claim];
    if (sql.includes('resolve_signed_reference'))
      result = fixture.context.operationId;
    if (sql.includes('transfer_context')) result = fixture.context;
    if (sql.includes('settle_custody')) result = 'completed';
    return { rows: [{ result }] };
  });
});
describe('launch to existing signed custody dispatcher', () => {
  it('claims stored signed bytes, resolves exact API crosswalk, and settles once without financial HTTP', async () => {
    const fetchImplementation = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe('GET');
        const parsed = new URL(String(url));
        const payload = parsed.pathname.endsWith('/verify')
          ? fixture.verification
          : parsed.pathname.includes('/transaction/')
            ? fixture.single
            : parsed.pathname.endsWith(fixture.context.sourceWalletId)
              ? fixture.sourceWallet
              : fixture.destinationWallet;
        return Response.json(payload);
      }
    );
    const result = await runPrimaryCardCustodyLaunch({
      mode: 'once',
      environment,
      readBinding: async () => bytes,
      fetchImplementation,
      now: () => fixture.now,
    });
    expect(result).toMatchObject({
      status: 'batch_finished',
      claimed: 1,
      receiptsProcessed: 1,
      deferred: 0,
      fundingComplete: false,
    });
    expect(
      mocks.query.mock.calls.filter(([sql]) => sql.includes('settle_custody'))
    ).toHaveLength(1);
    expect(
      mocks.query.mock.calls
        .find(([sql]) => sql.includes('finish_signed_inbox'))?.[1]
        .at(-1)
    ).toBe('completed');
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });
  it('does not finish successfully when independent provider observation fails', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('private-provider-failure');
    });
    await expect(
      runPrimaryCardCustodyLaunch({
        mode: 'once',
        environment,
        readBinding: async () => bytes,
        fetchImplementation,
        now: () => fixture.now,
      })
    ).rejects.toThrow('worker unavailable');
    expect(
      mocks.query.mock.calls.filter(([sql]) => sql.includes('settle_custody'))
    ).toHaveLength(0);
    expect(
      mocks.query.mock.calls
        .find(([sql]) => sql.includes('finish_signed_inbox'))?.[1]
        .at(-1)
    ).toBe('io_retry');
  });
});
