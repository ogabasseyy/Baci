import { Client } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));
const fixture = prefundedCardCheckoutFixture();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkout restricted executor profiles', () => {
  it.each([
    'customer',
    'verifier',
  ] as const)('verifies the %s profile identity and membership before its fixed query', async (kind) => {
    const configuration =
      kind === 'customer'
        ? fixture.configuration.customerDatabase
        : fixture.configuration.verifierDatabase;
    const roleNames =
      kind === 'customer'
        ? [
            'prefunded_card_authorization_reader',
            'prefunded_treasury_ledger_worker',
          ]
        : ['prefunded_card_authorization_provisioner'];
    const client = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
      getTransactionStatus: vi.fn(() => 'I'),
      query: vi.fn(async (query: string) => ({
        command: query === 'COMMIT' ? 'COMMIT' : 'SELECT',
        rows: query.includes('executor_system_identity')
          ? [
              {
                result: {
                  database: configuration.database,
                  login: configuration.login,
                  systemIdentifier: fixture.scope.systemIdentifier,
                },
              },
            ]
          : query.includes('FROM pg_catalog.pg_roles')
            ? [
                {
                  database_name: configuration.database,
                  role_name: configuration.login,
                  login_role: configuration.login,
                  is_superuser: false,
                  bypasses_rls: false,
                  creates_role: false,
                  creates_database: false,
                  replicates: false,
                  can_login: true,
                  inherits_privileges: false,
                  memberships: roleNames.map((role_name) => ({
                    role_name,
                    admin_option: false,
                    can_login: false,
                    is_superuser: false,
                    bypasses_rls: false,
                    creates_role: false,
                    creates_database: false,
                    replicates: false,
                  })),
                  inherited_memberships: [],
                  fsync_enabled: 'on',
                  synchronous_commit: 'on',
                  is_replica: false,
                },
              ]
            : [],
      })),
    };
    vi.mocked(Client).mockImplementation(function StubClient() {
      return client as never;
    } as never);
    const query =
      kind === 'customer'
        ? statements.checkoutReserve
        : statements.checkoutClaim;
    const parameters = [
      JSON.stringify(fixture.scope),
      JSON.stringify(kind === 'customer' ? fixture.request : fixture.selection),
    ];
    await createPrefundedCardPostgresExecutor(configuration)(
      query.text,
      parameters
    );
    expect(client.query).toHaveBeenCalledWith(query.text, parameters);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        user: configuration.login,
        ssl: { rejectUnauthorized: true },
      })
    );
  });

  it('refuses a promotion on the customer profile before opening a connection', async () => {
    await expect(
      createPrefundedCardPostgresExecutor(
        fixture.configuration.customerDatabase
      )(statements.checkoutPromote.text, [
        JSON.stringify(fixture.scope),
        JSON.stringify(fixture.selection),
        JSON.stringify(fixture.collection),
      ])
    ).rejects.toThrow('Prefunded card database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });
});
