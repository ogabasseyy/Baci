import { describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_SAAS_CNAME_TARGET,
  CloudflareSaasError,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostnameVerified,
  extractCloudflareVerificationRecords,
  findCloudflareCustomHostnameByName,
} from './cloudflare-saas';

const CONFIG = {
  apiToken: 'cf-token',
  zoneId: 'zone-saas-1',
};

describe('cloudflare-saas client', () => {
  it('extracts routing CNAME, ownership TXT, and SSL DCV TXT records', () => {
    const records = extractCloudflareVerificationRecords('shop.merchant.test', {
      id: 'ch-1',
      hostname: 'shop.merchant.test',
      status: 'pending',
      ownership_verification: {
        type: 'txt',
        name: '_cf-custom-hostname.shop.merchant.test',
        value: 'owner-tok',
      },
      ssl: {
        status: 'pending_validation',
        validation_records: [
          {
            txt_name: '_acme-challenge.shop.merchant.test',
            txt_value: 'dcv-tok',
          },
        ],
      },
    });

    expect(records).toEqual([
      {
        name: 'shop.merchant.test',
        purpose: 'routing',
        status: 'pending',
        type: 'CNAME',
        value: CLOUDFLARE_SAAS_CNAME_TARGET,
      },
      {
        name: '_cf-custom-hostname.shop.merchant.test',
        purpose: 'cloudflare_ownership',
        status: 'pending',
        type: 'TXT',
        value: 'owner-tok',
      },
      {
        name: '_acme-challenge.shop.merchant.test',
        purpose: 'cloudflare_ssl_dcv',
        status: 'pending',
        type: 'TXT',
        value: 'dcv-tok',
      },
    ]);
  });

  it('finds an exact hostname match in the expected zone', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: [
            { id: 'ch-other', hostname: 'other.test', status: 'active' },
            {
              id: 'ch-match',
              hostname: 'shop.merchant.test',
              status: 'pending',
            },
          ],
        }),
        { status: 200 }
      )
    );

    const found = await findCloudflareCustomHostnameByName(
      'SHOP.MERCHANT.TEST',
      { ...CONFIG, fetchImpl }
    );
    expect(found?.id).toBe('ch-match');
  });

  it('creates a custom hostname with TXT DV SSL settings', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            id: 'ch-new',
            hostname: 'shop.merchant.test',
            status: 'pending',
          },
        }),
        { status: 201 }
      )
    );

    const created = await createCloudflareCustomHostname('shop.merchant.test', {
      ...CONFIG,
      fetchImpl,
    });
    expect(created.id).toBe('ch-new');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('verifies hostname match before deleting and rejects mismatched provider IDs', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            id: 'ch-victim',
            hostname: 'victim.other-merchant.test',
            status: 'active',
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      deleteCloudflareCustomHostnameVerified(
        'shop.merchant.test',
        'ch-victim',
        {
          ...CONFIG,
          fetchImpl,
        }
      )
    ).rejects.toThrow(CloudflareSaasError);
    // Must NEVER issue DELETE when remote hostname does not match
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('looks up by exact hostname when cloudflareHostnameId is null and deletes it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: 'ch-recovered',
                hostname: 'shop.merchant.test',
                status: 'pending',
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'ch-recovered' } }),
          { status: 200 }
        )
      );

    const result = await deleteCloudflareCustomHostnameVerified(
      'shop.merchant.test',
      null,
      { ...CONFIG, fetchImpl }
    );
    expect(result).toEqual({ deleted: true, resolvedId: 'ch-recovered' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
