import { beforeEach, expect, it, vi } from 'vitest';
import { primaryWalletPaidInterestSchemas as schemas } from '@/schemas/primary-wallet-paid-interest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { createPrimaryWalletPaidInterestStore } from './primary-wallet-paid-interest-store';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      mocks.construct(config);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const selection = schemas.selection.parse({
  webhookCustomerId: fixture.event.customer_id,
  sourceWalletId: fixture.event.pvb_wallet,
  accruedWalletId: fixture.event.pvb_accrued_interest_wallet,
  destinationWalletId: fixture.event.eventData.destination_wallet,
  envelopeDestinationWalletId: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement: string) =>
    statement.includes('pg_stat_ssl')
      ? {
          rows: [
            {
              database_name: 'postgres',
              login_name: fixture.config.database.login,
              role_name: fixture.config.database.login,
              safe: true,
              tls: true,
            },
          ],
        }
      : { rows: [{ result: fixture.crosswalk }] }
  );
});
it('reports crosswalk involvement without resolving eligibility', async () => {
  mocks.query.mockImplementation(async (statement: string) =>
    statement.includes('pg_stat_ssl')
      ? {
          rows: [
            {
              database_name: 'postgres',
              login_name: fixture.config.database.login,
              role_name: fixture.config.database.login,
              safe: true,
              tls: true,
            },
          ],
        }
      : { rows: [{ result: false }] }
  );
  expect(
    await createPrimaryWalletPaidInterestStore(fixture.config).involved(
      selection
    )
  ).toBe(false);
  expect(mocks.query).toHaveBeenLastCalledWith(
    'SELECT piggyvest_primary.paid_interest_event_involved($1::uuid,$2::text,$3::jsonb) AS result',
    [fixture.config.integrationId, 'production', JSON.stringify(selection)]
  );
});
it('reads only the environment-bound exact crosswalk through a verified restricted TLS session', async () => {
  expect(
    await createPrimaryWalletPaidInterestStore(fixture.config).resolveCrosswalk(
      selection
    )
  ).toEqual(fixture.crosswalk);
  expect(mocks.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: { rejectUnauthorized: true, ca: 'test-only-ca' },
    })
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    'SELECT piggyvest_primary.read_paid_interest_crosswalk($1::uuid,$2::text,$3::jsonb) AS result',
    [fixture.config.integrationId, 'production', JSON.stringify(selection)]
  );
});
it('returns a missing prerequisite without provisioning a mapping', async () => {
  mocks.query.mockImplementation(async (statement: string) =>
    statement.includes('pg_stat_ssl')
      ? {
          rows: [
            {
              database_name: 'postgres',
              login_name: fixture.config.database.login,
              role_name: fixture.config.database.login,
              safe: true,
              tls: true,
            },
          ],
        }
      : { rows: [{ result: null }] }
  );
  expect(
    await createPrimaryWalletPaidInterestStore(fixture.config).resolveCrosswalk(
      selection
    )
  ).toBeNull();
  expect(mocks.query).toHaveBeenCalledTimes(2);
});
it('refuses unsafe sessions without reading financial state', async () => {
  mocks.query.mockResolvedValue({ rows: [{ safe: false }] });
  await expect(
    createPrimaryWalletPaidInterestStore(fixture.config).resolveCrosswalk(
      selection
    )
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('does not leak database errors or retry uncertain operations', async () => {
  mocks.connect.mockRejectedValue(new Error('private diagnostic'));
  await expect(
    createPrimaryWalletPaidInterestStore(fixture.config).resolveCrosswalk(
      selection
    )
  ).rejects.toThrow('Primary paid-interest database unavailable');
  expect(mocks.connect).toHaveBeenCalledOnce();
  expect(mocks.end).toHaveBeenCalledOnce();
});
