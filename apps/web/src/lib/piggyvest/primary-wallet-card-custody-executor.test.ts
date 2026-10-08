import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { primaryCardCustodyInboxFixture as inboxFixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  create: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.create(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});
describe('restricted custody executor', () => {
  it('does not permit custody credit or intake SQL from the financial transfer profile', async () => {
    const {
      custody: _custody,
      webhookSecret: _webhookSecret,
      ...runtime
    } = fixture.configuration;
    const execute = createPrimaryCardCustodyExecutor({
      ...runtime,
      transferOnly: true,
    });
    await expect(execute('settle', ['{}'])).rejects.toThrow(
      'storage unavailable'
    );
    await expect(
      execute('inboxEnqueue', ['{}', 'aa', 'signature'])
    ).rejects.toThrow('storage unavailable');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('uses a database intake-only role rather than settlement authority for enqueue', async () => {
    const config = readPrimaryCardCustodyIntakeRuntime(
      inboxFixture.environment,
      inboxFixture.now
    );
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'fixture',
            login_name: 'baci_primary_card_intake',
            role_name: 'baci_primary_card_intake',
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: 'accepted' }] });
    await createPrimaryCardCustodyExecutor(config)('inboxEnqueue', [
      '{}',
      'aa',
      'signature',
    ]);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'baci_primary_card_intake' })
    );
    expect(mocks.query.mock.calls[0][1]).toEqual([
      'primary_card_signed_intake',
    ]);
  });
  it('does not permit worker or settlement SQL from the intake-only profile', async () => {
    const config = readPrimaryCardCustodyIntakeRuntime(
      inboxFixture.environment,
      inboxFixture.now
    );
    await expect(
      createPrimaryCardCustodyExecutor(config)('settle', ['{}'])
    ).rejects.toThrow('Custody storage unavailable');
    await expect(
      createPrimaryCardCustodyExecutor(config)('inboxClaim', ['{}', '1'])
    ).rejects.toThrow('Custody storage unavailable');
    await expect(
      createPrimaryCardCustodyExecutor(config)('selectReadyTransfers', [
        '{}',
        '1',
      ])
    ).rejects.toThrow('Custody storage unavailable');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each([
    'claim',
    'record',
    'context',
    'settle',
  ] as const)('pins %s to a dedicated restricted TLS login and fixed statement', async (action) => {
    const role = ['claim', 'record'].includes(action) ? 'transfer' : 'custody';
    const parameters =
      action === 'record'
        ? [fixture.context.operationId, fixture.context.customerId, false]
        : [action === 'settle' ? '{}' : fixture.context.operationId];
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'fixture',
            login_name: `baci_primary_card_${role}`,
            role_name: `baci_primary_card_${role}`,
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: true }] });
    expect(
      await createPrimaryCardCustodyExecutor(fixture.configuration)(
        action,
        parameters
      )
    ).toBe(true);
    expect(mocks.query.mock.calls[1][1]).toEqual([
      fixture.context.integrationId,
      'staging',
      ...parameters,
    ]);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: `baci_primary_card_${role}`,
        ssl: { rejectUnauthorized: true, ca: 'fixture-ca' },
      })
    );
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it.each([
    { safe: false },
    { tls: false },
    { login_name: 'service_role' },
    { role_name: 'postgres' },
    { database_name: 'other' },
  ])('rejects unsafe or mismatched database identity %#', async (change) => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'fixture',
          login_name: 'baci_primary_card_custody',
          role_name: 'baci_primary_card_custody',
          safe: true,
          tls: true,
          ...change,
        },
      ],
    });
    await expect(
      createPrimaryCardCustodyExecutor(fixture.configuration)('settle', ['{}'])
    ).rejects.toThrow('Custody storage unavailable');
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed storage arity before connection', async () => {
    await expect(
      createPrimaryCardCustodyExecutor(fixture.configuration)('claim', [])
    ).rejects.toThrow('Custody storage unavailable');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each([
    ['inboxReadiness', ['{}']],
    ['inboxEnqueue', ['{}', 'aa'.repeat(65536), 'a'.repeat(128)]],
    ['inboxClaim', ['{}', '2']],
    [
      'inboxResolve',
      ['{}', fixture.context.reference, fixture.context.sourceWalletId],
    ],
    ['inboxFinish', ['{}', 'event', fixture.context.customerId, 'io_retry']],
  ] as const)('restricts %s signed inbox SQL to custody capability and bounded parameters', async (action, parameters) => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'fixture',
            login_name: 'baci_primary_card_custody',
            role_name: 'baci_primary_card_custody',
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: true }] });
    expect(
      await createPrimaryCardCustodyExecutor(fixture.configuration)(
        action,
        parameters
      )
    ).toBe(true);
    expect(mocks.query.mock.calls[0][1]).toEqual([
      'primary_card_custody_evidence',
    ]);
    expect(mocks.query.mock.calls[1][1]).toEqual([
      fixture.context.integrationId,
      fixture.context.environment,
      ...parameters,
    ]);
  });
});
