import { beforeEach, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';
import { enabledPrimaryCardRuntimeEnv } from '@/lib/piggyvest/primary-wallet-card-checkout-runtime.test-support';
import { runPrimaryCardCheckoutAbandonmentCli } from './primary-wallet-card-checkout-abandonment-cli';

// After card top-up initialization was retired, the abandonment drain must
// still run end to end through the REAL runtime reader, abandonment scan,
// provider and restricted executor. Only the PostgreSQL driver and the
// Paystack transport are fakes, recording every statement sent.
const db = vi.hoisted(() => ({ statements: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    private readonly login: string;
    constructor(options: { user: string }) {
      this.login = options.user;
    }
    async connect() {}
    async end() {}
    async query(text: string) {
      if (text.includes('pg_stat_ssl'))
        return {
          rows: [
            {
              database_name: fixture.database.name,
              login_name: this.login,
              role_name: this.login,
              safe: true,
              tls: true,
            },
          ],
        };
      db.statements.push(text);
      if (text.includes('select_stale_ready_checkouts'))
        return {
          rows: [
            {
              result: [
                {
                  ...fixture.intent,
                  status: 'ready',
                  authorizationUrl: 'https://checkout.paystack.com/fixture123',
                  expiresAt: fixture.settings.expiresAt,
                  callbackUrl: fixture.settings.callbackUrl,
                },
              ],
            },
          ],
        };
      if (text.includes('record_abandonment'))
        return { rows: [{ result: true }] };
      throw new Error('Unexpected statement');
    }
  },
}));

const abandonedOnPaystack = {
  status: true,
  data: {
    id: 12345,
    reference: fixture.intent.reference,
    amount: fixture.intent.amountKobo,
    currency: 'NGN',
    domain: 'test',
    channel: 'card',
    status: 'abandoned',
    customer: { email: fixture.intent.email },
    metadata: {
      transaction_type: 'primary_wallet_card_checkout',
      operation_id: fixture.intent.operationId,
      integration_id: fixture.intent.integrationId,
      merchant_id: fixture.intent.merchantId,
      customer_id: fixture.intent.customerId,
      user_id: fixture.intent.userId,
      environment: fixture.intent.environment,
      request_fingerprint: fixture.intent.fingerprint,
    },
  },
};

beforeEach(() => {
  db.statements.length = 0;
});

it('abandons a provider-confirmed dead checkout without touching initialization', async () => {
  const write = vi.fn();
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(abandonedOnPaystack), { status: 200 })
    );
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({
      argv: ['--once'],
      env: { ...enabledPrimaryCardRuntimeEnv },
      fetchImplementation,
      write,
    })
  ).toBe(0);
  expect(write).toHaveBeenCalledWith(
    '{"selected":1,"abandoned":1,"collected":0,"skipped":0}'
  );
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
    `https://api.paystack.co/transaction/verify/${fixture.intent.reference}`
  );
  expect(db.statements).toHaveLength(2);
  expect(db.statements[0]).toContain('select_stale_ready_checkouts');
  expect(db.statements[1]).toContain('record_abandonment');
  for (const statement of db.statements)
    expect(statement).not.toMatch(
      /piggyvest_primary_card\.(reserve|claim_initialization|record_initialization)\(/
    );
});
