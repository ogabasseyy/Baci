import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Regression for the plan's blocking issue 12: turning the direct inflow on
// (PIGGYVEST_PRIMARY_INFLOWS_ENABLED=true) before the engine fences exist
// must not credit anything. Only the database driver is replaced: the
// runtime reader, the signed-inflow boundary, the executor and the readiness
// reader all run for real against the stub's answer.
const pg = vi.hoisted(() => ({
  statements: [] as string[],
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    connect = pg.connect;
    end = pg.end;
    async query(statement: string) {
      pg.statements.push(statement);
      if (statement.includes('pg_stat_ssl'))
        return {
          rows: [
            {
              database_name: 'fixture_db',
              login_name: 'baci_piggyvest_primary_evidence',
              role_name: 'baci_piggyvest_primary_evidence',
              safe: true,
              tls: true,
            },
          ],
        };
      if (statement.includes('piggyvest_primary.engine_ready('))
        // Exactly what the installed stub migration returns.
        return {
          rows: [
            {
              result: {
                ready: false,
                missing: ['engine_readiness_not_installed'],
              },
            },
          ],
        };
      return { rows: [{ result: 'credited' }] };
    }
  },
}));

import { dispatchPrimaryPiggyvestIntake } from '@/app/api/webhooks/piggyvest/primary-webhook-dispatch';
import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { dispatchPrimaryWalletInflow } from './primary-wallet-inflow-dispatch';

const enabled = {
  PIGGYVEST_PRIMARY_INFLOWS_ENABLED: 'true',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: bank.config.integrationId,
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
  PIGGYVEST_PRIMARY_DB_HOST: bank.config.database.host,
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: bank.config.database.name,
  PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: 'synthetic-password',
  PIGGYVEST_PRIMARY_DB_CA: 'synthetic-ca',
  VERCEL_ENV: 'preview',
  // The bank inbox stays off, so the direct inflow executor owns the event.
  PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'false',
};

beforeEach(() => {
  pg.statements.length = 0;
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  for (const [name, value] of Object.entries(enabled)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it('with the flag on and the stub installed, never calls apply_inflow and returns prerequisite', async () => {
  const outcome = await dispatchPrimaryWalletInflow({
    rawBody: bank.rawBody,
    signature: bank.signature,
    secret: bank.config.webhookSecret,
    families: ['bank'],
  });
  expect(outcome).toBe('prerequisite');
  expect(pg.statements.some((s) => s.includes('engine_ready'))).toBe(true);
  expect(pg.statements.some((s) => s.includes('apply_inflow'))).toBe(false);
});

it('answers the provider retryable, so the captured delivery replays later instead of reaching any other credit path', async () => {
  const response = await dispatchPrimaryPiggyvestIntake({
    rawBody: bank.rawBody,
    signature: bank.signature,
    matchedSecret: bank.config.webhookSecret,
    event: bank.event as never,
    families: ['legacy'],
  });
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(503);
  expect(await (response as Response).json()).toEqual({
    received: false,
    code: 'PIGGYVEST_PRIMARY_INFLOW_NOT_READY',
    error: 'Primary wallet inflow not ready',
  });
  expect(pg.statements.some((s) => s.includes('apply_inflow'))).toBe(false);
});
