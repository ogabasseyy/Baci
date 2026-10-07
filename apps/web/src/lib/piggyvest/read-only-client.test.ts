import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { retrievePiggyvestStagingWallet } from './read-only-client';
import { createPiggyvestStagingConfiguration } from './staging-config';

const configuration = createPiggyvestStagingConfiguration({
  apiSecret: 'synthetic-staging-secret',
  expectedBusinessId: 'business-synthetic',
  timeoutMs: 500,
  maxResponseBytes: 1_024,
});

const walletResponse = {
  status: true,
  data: {
    id: 'wallet-synthetic',
    business_id: 'business-synthetic',
    currency: 'NGN',
    balance: 12_345,
    status: 'undocumented-provider-status',
  },
};

describe('retrievePiggyvestStagingWallet', () => {
  it('reads the requested wallet from the fixed staging origin exactly once', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(walletResponse));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).resolves.toEqual(walletResponse);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://staging.piggyvest.business/api/v1/wallet/wallet-synthetic',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-staging-secret' },
      })
    );
  });

  it('rejects forged configuration before sending a request', async () => {
    const fetchImplementation = vi.fn();

    await expect(
      retrievePiggyvestStagingWallet({
        configuration: {
          ...configuration,
          apiBaseUrl: 'https://attacker.example',
        },
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
      message:
        'PiggyVest staging wallet retrieval failed: INVALID_CONFIGURATION.',
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    '.',
    '..',
    '../wallet',
    'wallet/../other',
    'a'.repeat(513),
  ])('rejects unsafe wallet identifier (%s) before sending a request', async (walletId) => {
    const fetchImplementation = vi.fn();

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId,
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_WALLET_ID',
      message: 'PiggyVest staging wallet retrieval failed: INVALID_WALLET_ID.',
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects a non-string wallet identifier before sending a request', async () => {
    const fetchImplementation = vi.fn();

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 123 as unknown as string,
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_WALLET_ID',
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('projects documented wallet fields and strips provider extras', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        ...walletResponse,
        provider_message: 'do-not-return',
        data: {
          ...walletResponse.data,
          customer_email: 'do-not-return@example.test',
        },
      })
    );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).resolves.toEqual(walletResponse);
  });

  it('rejects a response for a different requested wallet', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        ...walletResponse,
        data: { ...walletResponse.data, id: 'other-wallet' },
      })
    );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'WALLET_ID_MISMATCH',
    });
  });

  it('rejects a response for a different business', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        ...walletResponse,
        data: { ...walletResponse.data, business_id: 'other-business' },
      })
    );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'BUSINESS_ID_MISMATCH',
    });
  });

  it('rejects a response with an unexpected currency', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        ...walletResponse,
        data: { ...walletResponse.data, currency: 'USD' },
      })
    );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'CURRENCY_MISMATCH',
    });
  });

  it('redacts credentials and provider body data from failures', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ secret: 'provider-secret', balance: '999' }),
          { status: 500 }
        )
      );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'HTTP_STATUS',
      message: 'PiggyVest staging wallet retrieval failed: HTTP_STATUS.',
    });
  });

  it('rejects a declared response body above the configured bound', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(walletResponse), {
        headers: { 'content-length': '1025' },
      })
    );

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('cancels a streamed response that exceeds the byte bound', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(1_025)));
      },
      cancel,
    });
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(body));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not wait for a stalled stream cancellation after a byte overflow', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(1_025)));
      },
      cancel,
    });
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(body));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });

    expect(cancel).toHaveBeenCalledOnce();
  }, 1_000);

  it('maps response body stream errors without returning provider details', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('provider body detail'));
      },
    });
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(body));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'BODY_READ_ERROR',
    });
  });

  it('bounds response body reads with the configured timeout', async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(body));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration: { ...configuration, timeoutMs: 20 },
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('does not retry a failed provider request', async () => {
    const fetchImplementation = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'wallet-synthetic',
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
