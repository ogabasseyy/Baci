import 'server-only';
import { Client } from 'pg';
import type { WalletDvaProvisionerRuntime } from '@/schemas/wallet-dva-provisioner-runtime';

export const WALLET_DVA_PROVISIONER_STATEMENT =
  'SELECT wallet_dva_private.record_paystack_customer_wallet_dva($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::timestamptz) AS result';

const VERIFY_SESSION = `SELECT current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
    AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_catalog.pg_has_role(SESSION_USER, 'baci_wallet_dva_writer', 'MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'baci_wallet_dva_writer')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.customer_wallet_payment_accounts', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.customer_wallet_payment_accounts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.customer_wallet_payment_accounts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.customer_wallet_payment_accounts', 'DELETE')
    AND pg_catalog.has_function_privilege(SESSION_USER,
      'wallet_dva_private.record_paystack_customer_wallet_dva(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamp with time zone)',
      'EXECUTE')) AS safe,
  EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl) AS tls
  FROM pg_catalog.pg_roles role WHERE role.rolname=SESSION_USER`;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isBoundedText(value: string, maximum: number) {
  const length = Array.from(value).length;
  return (
    length > 0 &&
    length <= maximum &&
    value.trim() !== '' &&
    !/\p{Cc}/u.test(value)
  );
}

const SAFE_P0001_CODES = [
  'WALLET_DVA_DISABLED_ACCOUNT',
  'WALLET_DVA_PENDING_REVIEW_CONFLICT',
  'WALLET_DVA_PROVIDER_CUSTOMER_CONFLICT',
  'WALLET_DVA_RECEIVER_CONFLICT',
  'WALLET_DVA_SUBACCOUNT_CONFLICT',
  'PAYSTACK_DVA_ALIAS_CONFLICT',
] as const;

function matchesCodePrefix(message: string, code: string) {
  return (
    message === code ||
    message.startsWith(`${code}:`) ||
    message.startsWith(`${code} `)
  );
}

function extractSafeDatabaseErrorCode(error: unknown): string | null {
  if (
    !error ||
    typeof error !== 'object' ||
    !('message' in error) ||
    typeof error.message !== 'string'
  ) {
    return null;
  }

  const sqlState =
    'code' in error && typeof error.code === 'string'
      ? error.code.trim()
      : undefined;
  const normalizedMessage = error.message
    .trim()
    .replace(/^ERROR:\s*/i, '')
    .trim();

  if (sqlState === undefined || sqlState === 'P0001') {
    const conflictCode = SAFE_P0001_CODES.find((code) =>
      matchesCodePrefix(normalizedMessage, code)
    );
    if (conflictCode) return conflictCode;
  }

  if (
    sqlState === '22023' &&
    matchesCodePrefix(normalizedMessage, 'invalid_wallet_dva_arguments')
  ) {
    return 'invalid_wallet_dva_arguments';
  }

  if (
    sqlState === '42501' &&
    matchesCodePrefix(
      normalizedMessage,
      'wallet_dva_owner_or_merchant_mismatch'
    )
  ) {
    return 'wallet_dva_owner_or_merchant_mismatch';
  }

  return null;
}

export interface WalletDvaProvisionerInput {
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankSlug: string | null;
  consentedAt: string;
  currency: 'NGN';
  customerId: string;
  merchantId: string;
  providerAccountId: string | null;
  providerCustomerCode: string;
  providerSubaccountCode: string;
  userId: string;
}

export function createWalletDvaProvisionerExecutor(
  configuration: WalletDvaProvisionerRuntime
) {
  return async (input: WalletDvaProvisionerInput): Promise<unknown> => {
    const parameters = [
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
    ];
    if (
      parameters.length !== 12 ||
      !UUID.test(input.userId) ||
      !UUID.test(input.customerId) ||
      !UUID.test(input.merchantId) ||
      !/^CUS_[A-Za-z0-9]+$/.test(input.providerCustomerCode) ||
      !/^ACCT_[A-Za-z0-9]+$/.test(input.providerSubaccountCode) ||
      (input.providerAccountId !== null &&
        !/^\d{1,20}$/.test(input.providerAccountId)) ||
      !/^\d{10}$/.test(input.accountNumber) ||
      !isBoundedText(input.accountName, 160) ||
      !isBoundedText(input.bankName, 120) ||
      (input.bankSlug !== null && !isBoundedText(input.bankSlug, 120)) ||
      input.currency !== 'NGN' ||
      !Number.isFinite(Date.parse(input.consentedAt))
    ) {
      throw new Error('Wallet DVA writer unavailable');
    }

    const client = new Client({
      host: configuration.database.host,
      port: configuration.database.port,
      database: configuration.database.name,
      user: configuration.database.login,
      password: configuration.database.password,
      ssl: {
        rejectUnauthorized: true,
        ca: configuration.database.certificateAuthority,
      },
      connectionTimeoutMillis: 4000,
      query_timeout: 4000,
      statement_timeout: 2500,
      lock_timeout: 1500,
      options: '-c search_path=pg_catalog',
      application_name: 'baci-wallet-dva-provisioner',
    });

    try {
      await client.connect();
      const result = await client.query<{
        database_name: string;
        login_name: string;
        role_name: string;
        safe: boolean;
        tls: boolean;
      }>(VERIFY_SESSION);
      const session = result.rows[0];
      if (
        result.rows.length !== 1 ||
        !session ||
        session.database_name !== configuration.database.name ||
        session.login_name !== configuration.database.login ||
        session.role_name !== configuration.database.login ||
        session.safe !== true ||
        session.tls !== true
      ) {
        throw new Error('Invalid wallet DVA writer session');
      }
      const written = await client.query<{ result: unknown }>(
        WALLET_DVA_PROVISIONER_STATEMENT,
        parameters
      );
      return written.rows[0]?.result;
    } catch (error) {
      const safeCode = extractSafeDatabaseErrorCode(error);
      if (safeCode) {
        throw new Error(safeCode);
      }
      throw new Error('Wallet DVA writer unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
