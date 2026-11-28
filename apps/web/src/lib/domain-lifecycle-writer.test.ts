import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDomainLifecycleWriterRuntime } from '@/schemas/domain-lifecycle-writer-runtime';

const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => ({
  Client: class MockClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
  },
}));

import {
  createDomainLifecycleWriter,
  DomainLifecycleWriterError,
} from './domain-lifecycle-writer';

const VALID_RUNTIME = {
  database: {
    certificateAuthority:
      '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
    host: 'db.example.supabase.co',
    login: 'baci_domain_lifecycle_provisioner' as const,
    name: 'postgres',
    password: 'super-secret-password',
    port: 5432,
  },
};

describe('domain-lifecycle-writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
  });

  it('returns null when DOMAIN_LIFECYCLE_WRITER_ENABLED is not true', () => {
    expect(readDomainLifecycleWriterRuntime({})).toBeNull();
    expect(createDomainLifecycleWriter(null)).toBeNull();
  });

  it('rejects session when least-privilege or TLS verification fails', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'postgres',
          login_name: 'baci_domain_lifecycle_provisioner',
          role_name: 'baci_domain_lifecycle_provisioner',
          safe: false,
          tls: true,
        },
      ],
    });

    const writer = createDomainLifecycleWriter(VALID_RUNTIME);
    expect(writer).not.toBeNull();
    await expect(writer?.claimDueBindings()).rejects.toThrow(
      DomainLifecycleWriterError
    );
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('claims due bindings after passing session verification', async () => {
    const binding = {
      id: 'b1',
      domain_id: 'd1',
      merchant_id: 'm1',
      hostname: 'shop.example.com',
      dns_routing_provider: 'cloudflare_saas',
      cloudflare_zone_id: 'zone_1',
      cloudflare_hostname_id: null,
      requested_is_primary: false,
      lifecycle_state: 'provisioning',
      current_operation_id: 'op1',
      in_flight_lease_until: '2026-11-28T13:00:00Z',
      cloudflare_create_state: 'in_flight',
      vercel_create_state: 'none',
      next_reconcile_at: '2026-11-28T13:00:00Z',
      provider_verification_records: [],
    };

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'postgres',
            login_name: 'baci_domain_lifecycle_provisioner',
            role_name: 'baci_domain_lifecycle_provisioner',
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [binding] });

    const writer = createDomainLifecycleWriter(VALID_RUNTIME);
    const claimed = await writer?.claimDueBindings(5, 45);
    expect(claimed).toEqual([binding]);
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM domain_lifecycle_private.claim_due_domain_bindings($1::int, $2::int)',
      [5, 45]
    );
  });

  it('maps stale_or_invalid_operation_id to STALE_OPERATION_ID', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'postgres',
            login_name: 'baci_domain_lifecycle_provisioner',
            role_name: 'baci_domain_lifecycle_provisioner',
            safe: true,
            tls: true,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('stale_or_invalid_operation_id'));

    const writer = createDomainLifecycleWriter(VALID_RUNTIME);
    await expect(
      writer?.recordProviderResult({
        domainId: 'd1',
        operationId: 'old-op',
        provider: 'cloudflare',
        state: 'confirmed',
      })
    ).rejects.toMatchObject({ code: 'STALE_OPERATION_ID' });
  });
});
