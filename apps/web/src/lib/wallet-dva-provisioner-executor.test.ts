import { readFileSync } from 'node:fs';
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

  it.each([
    '',
    '   ',
    'bad\u0007slug',
  ])('rejects an empty or control-character bank slug (%j) before connecting', async (bankSlug) => {
    await expect(
      createWalletDvaProvisionerExecutor(configuration)({
        ...input,
        bankSlug,
      })
    ).rejects.toThrow('Wallet DVA writer unavailable');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'paystack-id-1',
    '123456789012345678901',
  ])('rejects non-numeric or overlong providerAccountId (%j) before connecting', async (providerAccountId) => {
    await expect(
      createWalletDvaProvisionerExecutor(configuration)({
        ...input,
        providerAccountId,
      })
    ).rejects.toThrow('Wallet DVA writer unavailable');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('maps SQLSTATE P0001 conflict codes with detail suffixes and preserves 22023/42501 validation rejections', async () => {
    const okSession = {
      rows: [
        {
          database_name: 'postgres',
          login_name: 'baci_wallet_dva_provisioner',
          role_name: 'baci_wallet_dva_provisioner',
          safe: true,
          tls: true,
        },
      ],
    };
    const execute = createWalletDvaProvisionerExecutor(configuration);

    mockQuery.mockResolvedValueOnce(okSession).mockRejectedValueOnce(
      Object.assign(new Error('ERROR: PAYSTACK_DVA_ALIAS_CONFLICT: active'), {
        code: 'P0001',
      })
    );
    await expect(execute(input)).rejects.toThrow('PAYSTACK_DVA_ALIAS_CONFLICT');

    mockQuery.mockResolvedValueOnce(okSession).mockRejectedValueOnce(
      Object.assign(new Error('invalid_wallet_dva_arguments'), {
        code: '22023',
      })
    );
    await expect(execute(input)).rejects.toThrow(
      'invalid_wallet_dva_arguments'
    );

    mockQuery.mockResolvedValueOnce(okSession).mockRejectedValueOnce(
      Object.assign(new Error('wallet_dva_owner_or_merchant_mismatch'), {
        code: '42501',
      })
    );
    await expect(execute(input)).rejects.toThrow(
      'wallet_dva_owner_or_merchant_mismatch'
    );

    mockQuery.mockResolvedValueOnce(okSession).mockRejectedValueOnce(
      Object.assign(new Error('PAYSTACK_DVA_ALIAS_CONFLICT'), {
        code: '42P01',
      })
    );
    await expect(execute(input)).rejects.toThrow(
      'Wallet DVA writer unavailable'
    );
  });

  it('pins the shared wallet DVA alias trigger and writer SQL argument checks', () => {
    const aliasSql = readFileSync(
      `${process.cwd()}/../../supabase/migrations/20260825010000_serialize_paystack_dva_cross_flow_aliases.sql`,
      'utf8'
    );
    const repairSql = readFileSync(
      `${process.cwd()}/../../supabase/migrations/20260827050000_repair_paystack_dva_alias_snapshot_guards.sql`,
      'utf8'
    );
    const writerSql = readFileSync(
      `${process.cwd()}/../../supabase/migrations/20261122064203_wallet_dva_restricted_writer.sql`,
      'utf8'
    );

    expect(aliasSql).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_wallet_paystack_dva_alias()'
    );
    expect(aliasSql).toContain(
      "ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT'"
    );
    expect(repairSql).toContain(
      'CREATE TRIGGER guard_wallet_paystack_dva_alias'
    );
    expect(repairSql).toContain('ON public.customer_wallet_payment_accounts');
    expect(writerSql).toContain("p_provider_account_id !~ '^[0-9]{1,20}$'");
    expect(writerSql).toContain("pg_catalog.btrim(p_bank_slug) = ''");
  });
});
