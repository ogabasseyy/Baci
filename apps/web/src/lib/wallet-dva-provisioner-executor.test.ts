import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnect, mockEnd, mockQuery, mockClientConfig } = vi.hoisted(
  () => ({
    mockConnect: vi.fn(),
    mockEnd: vi.fn(),
    mockQuery: vi.fn(),
    mockClientConfig: vi.fn(),
  })
);

vi.mock('pg', () => ({
  Client: class {
    constructor(configuration: unknown) {
      mockClientConfig(configuration);
    }

    connect = mockConnect;

    end = mockEnd;

    query = mockQuery;
  },
}));

import {
  createWalletDvaProvisionerExecutor,
  WALLET_DVA_PROVISIONER_STATEMENT,
} from './wallet-dva-provisioner-executor';

const configuration = {
  database: {
    certificateAuthority: 'synthetic-ca',
    host: 'db.example.test',
    login: 'baci_wallet_dva_provisioner' as const,
    name: 'postgres',
    password: 'synthetic-password',
    port: 5432,
  },
};

const input = {
  accountName: 'José Store / Zoë',
  accountNumber: '1234567890',
  bankName: 'Wéma Bank',
  bankSlug: 'wema-bank',
  consentedAt: '2026-11-22T10:00:00.000Z',
  currency: 'NGN' as const,
  customerId: '11111111-1111-4111-8111-111111111111',
  merchantId: '22222222-2222-4222-8222-222222222222',
  providerAccountId: '97',
  providerCustomerCode: 'CUS_wallet1',
  providerSubaccountCode: 'ACCT_merchant1',
  userId: '33333333-3333-4333-8333-333333333333',
};

describe('wallet DVA provisioner executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
  });

  it('uses one fixed statement only after verifying the dedicated TLS role', async () => {
    const row = { id: 'wallet-row' };
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'postgres',
            login_name: 'baci_wallet_dva_provisioner',
            role_name: 'baci_wallet_dva_provisioner',
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: row }] });

    const execute = createWalletDvaProvisionerExecutor(configuration);
    await expect(execute(input)).resolves.toBe(row);

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      WALLET_DVA_PROVISIONER_STATEMENT,
      [
        input.userId,
        input.customerId,
        input.merchantId,
        input.providerCustomerCode,
        input.providerSubaccountCode,
        input.providerAccountId,
        input.accountNumber,
        input.accountName,
        input.bankName,
        input.bankSlug,
        input.currency,
        input.consentedAt,
      ]
    );
    expect(mockClientConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        application_name: 'baci-wallet-dva-provisioner',
        user: 'baci_wallet_dva_provisioner',
        ssl: expect.objectContaining({ rejectUnauthorized: true }),
      })
    );
  });

  it('fails closed before the write when session identity is not the exact worker login', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'postgres',
          login_name: 'service_role',
          role_name: 'service_role',
          safe: false,
          tls: true,
        },
      ],
    });

    await expect(
      createWalletDvaProvisionerExecutor(configuration)(input)
    ).rejects.toThrow('Wallet DVA writer unavailable');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid provider data before opening a database connection', async () => {
    await expect(
      createWalletDvaProvisionerExecutor(configuration)({
        ...input,
        accountName: '   ',
      })
    ).rejects.toThrow('Wallet DVA writer unavailable');
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
