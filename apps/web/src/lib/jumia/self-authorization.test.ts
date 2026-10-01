import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateJumiaSelfAuthorization } from '@/lib/jumia/self-authorization';

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => fetchMock.mockReset());

describe('validateJumiaSelfAuthorization', () => {
  it('exchanges the supplied pair and discovers shops', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-secret',
          refresh_token: 'rotated-secret',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          shops: [
            {
              id: 'shop-1',
              name: 'Merchant Shop',
              email: 'merchant@example.com',
              businessClients: [
                {
                  name: 'Jumia Nigeria',
                  code: 'NG',
                  countryCode: 'NG',
                  countryName: 'Nigeria',
                  status: 'active',
                  shortCode: 'ng',
                },
              ],
            },
          ],
        })
      );

    const result = await validateJumiaSelfAuthorization(
      { clientId: 'client-secret', refreshToken: 'refresh-secret' },
      { fetch: fetchMock, baseUrl: 'https://vendor.example' }
    );

    const tokenRequest = fetchMock.mock.calls[0][1];
    expect(String(tokenRequest?.body)).toContain('client_id=client-secret');
    expect(String(tokenRequest?.body)).toContain(
      'refresh_token=refresh-secret'
    );
    expect(fetchMock.mock.calls[1][0]).toBe('https://vendor.example/shops');
    expect(result.credentials.refreshToken).toBe('rotated-secret');
    expect(Date.parse(result.refreshTokenExpiresAt)).toBeGreaterThan(
      Date.now()
    );
    expect(result.shops).toEqual([
      {
        id: 'shop-1',
        businessClientCode: 'NG',
        name: 'Merchant Shop',
        countryCode: 'NG',
        marketplace: 'Jumia Nigeria',
      },
    ]);
  });

  it('rejects a self-authorization response without a newly rotated refresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-secret',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          shops: [
            {
              id: 'shop-1',
              name: 'Merchant Shop',
              email: 'merchant@example.com',
              businessClients: [
                {
                  name: 'Jumia Nigeria',
                  code: 'NG',
                  countryCode: 'NG',
                  countryName: 'Nigeria',
                  status: 'active',
                  shortCode: 'ng',
                },
              ],
            },
          ],
        })
      );

    await expect(
      validateJumiaSelfAuthorization(
        { clientId: 'client-secret', refreshToken: 'refresh-secret' },
        { fetch: fetchMock, baseUrl: 'https://vendor.example' }
      )
    ).rejects.toThrow('Jumia returned an invalid token response');
  });

  it('persists rotated credentials before shop discovery fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-secret',
          refresh_token: 'rotated-secret',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        })
      )
      .mockResolvedValueOnce(
        new Response('temporary provider failure', { status: 503 })
      );
    const onCredentialsRotated = vi.fn().mockResolvedValue(undefined);

    await expect(
      validateJumiaSelfAuthorization(
        { clientId: 'client-secret', refreshToken: 'refresh-secret' },
        {
          fetch: fetchMock,
          baseUrl: 'https://vendor.example',
          onCredentialsRotated,
        }
      )
    ).rejects.toThrow('Jumia shop discovery failed');

    expect(onCredentialsRotated).toHaveBeenCalledTimes(1);
    expect(onCredentialsRotated).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          clientId: 'client-secret',
          refreshToken: 'rotated-secret',
          accessToken: 'access-secret',
        },
        accessTokenExpiresAt: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
      })
    );
  });

  it('adds selection keys when one shop has multiple active marketplaces', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-secret',
          refresh_token: 'rotated-secret',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          shops: [
            {
              id: 'shop-1',
              name: 'Merchant Shop',
              email: 'merchant@example.com',
              businessClients: [
                {
                  name: 'Jumia Ghana',
                  code: 'GH',
                  countryCode: 'GH',
                  countryName: 'Ghana',
                  status: 'active',
                  shortCode: 'gh',
                },
                {
                  name: 'Jumia Nigeria',
                  code: 'NG',
                  countryCode: 'NG',
                  countryName: 'Nigeria',
                  status: 'active',
                  shortCode: 'ng',
                },
              ],
            },
          ],
        })
      );

    const result = await validateJumiaSelfAuthorization(
      { clientId: 'client-secret', refreshToken: 'refresh-secret' },
      { fetch: fetchMock, baseUrl: 'https://vendor.example' }
    );

    expect(result.shops).toEqual([
      {
        id: 'shop-1',
        selectionKey: 'shop-1:GH',
        businessClientCode: 'GH',
        name: 'Merchant Shop',
        countryCode: 'GH',
        marketplace: 'Jumia Ghana',
      },
      {
        id: 'shop-1',
        selectionKey: 'shop-1:NG',
        businessClientCode: 'NG',
        name: 'Merchant Shop',
        countryCode: 'NG',
        marketplace: 'Jumia Nigeria',
      },
    ]);
  });

  it('uses business client codes when two marketplaces share a country', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-secret',
          refresh_token: 'rotated-secret',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          shops: [
            {
              id: 'shop-1',
              name: 'Merchant Shop',
              email: 'merchant@example.com',
              businessClients: [
                {
                  name: 'Jumia Nigeria Retail',
                  code: 'NG-RETAIL',
                  countryCode: 'NG',
                  countryName: 'Nigeria',
                  status: 'active',
                  shortCode: 'ng-retail',
                },
                {
                  name: 'Jumia Nigeria Marketplace',
                  code: 'NG-MKT',
                  countryCode: 'NG',
                  countryName: 'Nigeria',
                  status: 'active',
                  shortCode: 'ng-mkt',
                },
              ],
            },
          ],
        })
      );

    const result = await validateJumiaSelfAuthorization(
      { clientId: 'client-secret', refreshToken: 'refresh-secret' },
      { fetch: fetchMock, baseUrl: 'https://vendor.example' }
    );

    expect(result.shops).toEqual([
      {
        id: 'shop-1',
        selectionKey: 'shop-1:NG-RETAIL',
        businessClientCode: 'NG-RETAIL',
        name: 'Merchant Shop',
        countryCode: 'NG',
        marketplace: 'Jumia Nigeria Retail',
      },
      {
        id: 'shop-1',
        selectionKey: 'shop-1:NG-MKT',
        businessClientCode: 'NG-MKT',
        name: 'Merchant Shop',
        countryCode: 'NG',
        marketplace: 'Jumia Nigeria Marketplace',
      },
    ]);
  });

  it('sanitizes provider rejection details', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('refresh_token=must-not-escape', { status: 401 })
    );

    await expect(
      validateJumiaSelfAuthorization(
        { clientId: 'client-secret', refreshToken: 'refresh-secret' },
        { fetch: fetchMock, baseUrl: 'https://vendor.example' }
      )
    ).rejects.toThrow('Jumia rejected the client ID or refresh token');
  });
});
