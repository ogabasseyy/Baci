import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { jumiaSelfAuthorizationHandler } from './self-authorization-handler';

const credentials = { clientId: 'client-id', refreshToken: 'refresh-token' };
const validated = {
  credentials: { ...credentials, accessToken: 'access-token' },
  accessTokenExpiresAt: '2026-08-13T12:00:00.000Z',
  refreshTokenExpiresAt: '2026-09-13T12:00:00.000Z',
  shops: [
    {
      id: 'shop-1',
      businessClientCode: 'NG-1',
      name: 'Shop One',
      countryCode: 'NG',
      marketplace: 'Jumia Nigeria',
    },
    {
      id: 'shop-2',
      businessClientCode: 'NG-2',
      name: 'Shop Two',
      countryCode: 'NG',
      marketplace: 'Jumia Nigeria',
    },
  ],
};

describe('Jumia Self Authorization handler', () => {
  it('discovers safe shops without writing credentials', async () => {
    const validate = vi.fn().mockResolvedValue(validated);
    const rpc = vi.fn();

    const response = await jumiaSelfAuthorizationHandler.discover({
      credentials,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      existingShopIds: new Set(['shop-2']),
      validate,
    });

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        { ...validated.shops[0], alreadyConnected: false },
        { ...validated.shops[1], alreadyConnected: true },
      ],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('revalidates, encrypts, and persists only selected discovered shops', async () => {
    const validate = vi.fn().mockResolvedValue(validated);
    const encrypt = vi.fn().mockReturnValue('opaque-ciphertext');
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          authorization_id: 'authorization-id',
          integration_id: 'integration-id',
          shop_id: 'shop-1',
          inserted: true,
        },
      ],
      error: null,
    });

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(),
      rpc,
      selectedShopIds: ['shop-1'],
      validate,
      encrypt,
    });

    expect(validate).toHaveBeenCalledWith(credentials);
    expect(encrypt).toHaveBeenCalledWith(
      validated.credentials,
      Buffer.alloc(32, 4).toString('base64'),
      `00000000-0000-4000-8000-000000000001:${createHash('sha256')
        .update(credentials.clientId)
        .digest('hex')}`
    );
    expect(rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      {
        p_merchant_id: '00000000-0000-4000-8000-000000000001',
        p_client_key_hash: createHash('sha256')
          .update(credentials.clientId)
          .digest('hex'),
        p_credential_ciphertext: 'opaque-ciphertext',
        p_token_expires_at: validated.accessTokenExpiresAt,
        p_refresh_token_expires_at: validated.refreshTokenExpiresAt,
        p_shop_ids: ['shop-1'],
        p_shop_names: ['Shop One'],
        p_country_codes: ['NG'],
        p_marketplace_labels: ['Jumia Nigeria'],
        p_business_client_codes: ['NG-1'],
        p_expected_rotation_version: null,
      }
    );
    expect(response.headers.get('x-jumia-discovery-complete')).toBe('false');
    await expect(response.json()).resolves.toEqual({
      connected: [{ id: 'shop-1', name: 'Shop One' }],
      alreadyConnected: [],
    });
  });

  it('completes discovery when all unconnected shops are selected', async () => {
    const validate = vi.fn().mockResolvedValue(validated);
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          authorization_id: 'authorization-id',
          integration_id: 'integration-id',
          shop_id: 'shop-1',
          inserted: true,
        },
      ],
      error: null,
    });

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(['shop-2']),
      rpc,
      selectedShopIds: ['shop-1'],
      validate,
      encrypt: vi.fn().mockReturnValue('opaque-ciphertext'),
    });

    expect(response.headers.get('x-jumia-discovery-complete')).toBe('true');
  });

  it('classifies inserted shops by selection order when shop ids collide', async () => {
    const shops = [
      {
        id: 'shop-1',
        selectionKey: 'shop-1:GH-1',
        businessClientCode: 'GH-1',
        name: 'Ghana Shop',
        countryCode: 'GH',
        marketplace: 'Jumia Ghana',
      },
      {
        id: 'shop-1',
        selectionKey: 'shop-1:NG-1',
        businessClientCode: 'NG-1',
        name: 'Nigeria Shop',
        countryCode: 'NG',
        marketplace: 'Jumia Nigeria',
      },
    ];
    const validate = vi.fn().mockResolvedValue({
      ...validated,
      shops,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          authorization_id: 'authorization-id',
          integration_id: 'integration-gh',
          shop_id: 'shop-1',
          inserted: true,
        },
        {
          authorization_id: 'authorization-id',
          integration_id: 'integration-ng',
          shop_id: 'shop-1',
          inserted: false,
        },
      ],
      error: null,
    });

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(),
      rpc,
      selectedShopIds: ['shop-1:GH-1', 'shop-1:NG-1'],
      validate,
      encrypt: vi.fn().mockReturnValue('opaque-ciphertext'),
    });

    await expect(response.json()).resolves.toEqual({
      connected: [{ id: 'shop-1', name: 'Ghana Shop' }],
      alreadyConnected: [{ id: 'shop-1', name: 'Nigeria Shop' }],
    });
    expect(rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({
        p_shop_ids: ['shop-1', 'shop-1'],
        p_business_client_codes: ['GH-1', 'NG-1'],
      })
    );
    expect(response.headers.get('x-jumia-discovery-complete')).toBe('true');
  });

  it('persists rotated credentials when every selected shop is already connected', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          authorization_id: 'authorization-id',
          integration_id: 'integration-id',
          shop_id: 'shop-1',
          inserted: false,
        },
      ],
      error: null,
    });
    const encrypt = vi.fn().mockReturnValue('opaque-ciphertext');

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(['shop-1']),
      rpc,
      selectedShopIds: ['shop-1'],
      validate: vi.fn().mockResolvedValue(validated),
      encrypt,
    });

    expect(encrypt).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({
        p_credential_ciphertext: 'opaque-ciphertext',
        p_shop_ids: ['shop-1'],
      })
    );
    await expect(response.json()).resolves.toEqual({
      connected: [],
      alreadyConnected: [{ id: 'shop-1', name: 'Shop One' }],
    });
  });

  it('returns 500 when persistence RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'rpc failed' },
    });

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(),
      rpc,
      selectedShopIds: ['shop-1'],
      validate: vi.fn().mockResolvedValue(validated),
      encrypt: vi.fn().mockReturnValue('opaque-ciphertext'),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to save selected Jumia shops',
    });
  });

  it('rejects a shop absent from fresh discovery before persistence', async () => {
    const rpc = vi.fn();

    const response = await jumiaSelfAuthorizationHandler.connect({
      credentials,
      encryptionKey: Buffer.alloc(32, 4).toString('base64'),
      merchantId: '00000000-0000-4000-8000-000000000001',
      existingShopIds: new Set(),
      rpc,
      selectedShopIds: ['invented-shop'],
      validate: vi.fn().mockResolvedValue(validated),
      encrypt: vi.fn(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Selected Jumia shop is no longer available',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
