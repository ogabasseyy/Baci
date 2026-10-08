import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateMocks = vi.hoisted(() => ({
  getRedvaultCallbackUrl: vi.fn(),
  verifyRedvaultLivePilotFunding: vi.fn(),
  verifyRedvaultLivePilotSnapshot: vi.fn(),
  pilotUserId: 'pilot-user',
}));

vi.mock('@/lib/checkout/redvault-callback-url', () => ({
  getRedvaultCallbackUrl: gateMocks.getRedvaultCallbackUrl,
}));
vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  REDVAULT_PILOT_USER_ID: gateMocks.pilotUserId,
}));
vi.mock('@/lib/checkout/redvault-live-pilot-verification', () => ({
  verifyRedvaultLivePilotFunding: gateMocks.verifyRedvaultLivePilotFunding,
  verifyRedvaultLivePilotSnapshot: gateMocks.verifyRedvaultLivePilotSnapshot,
}));

import {
  buildRedvaultLivePilotCallbackUrl,
  preserveRedvaultLivePilotAttempts,
  rejectInvalidRedvaultLivePilotFunding,
  rejectInvalidRedvaultLivePilotSnapshot,
  rejectUnauthorizedRedvaultLivePilot,
} from './redvault-live-pilot-initialize-gate';

describe('redvault live pilot initialize gate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    gateMocks.getRedvaultCallbackUrl.mockReset();
    gateMocks.verifyRedvaultLivePilotFunding.mockReset();
    gateMocks.verifyRedvaultLivePilotSnapshot.mockReset();
  });

  it('rejects a non-pilot user during the live pilot', () => {
    expect(
      rejectUnauthorizedRedvaultLivePilot({
        reason: 'private_live_pilot',
        userId: 'other-user',
      })
    ).toEqual({
      message: 'REDVAULT payment is not available',
      code: 'REDVAULT_UNAVAILABLE',
      status: 409,
    });
    expect(
      rejectUnauthorizedRedvaultLivePilot({
        reason: 'private_live_pilot',
        userId: 'pilot-user',
      })
    ).toBeNull();
    expect(
      rejectUnauthorizedRedvaultLivePilot({
        reason: 'staging_test_mode',
        userId: 'other-user',
      })
    ).toBeNull();
  });

  it('skips snapshot verification outside the live pilot', async () => {
    gateMocks.verifyRedvaultLivePilotSnapshot.mockResolvedValue({ ok: true });
    await expect(
      rejectInvalidRedvaultLivePilotSnapshot({
        redvaultRequested: false,
        isLivePilot: true,
        client: {} as never,
        orderId: 'order',
        userId: 'pilot-user',
        merchantId: 'merchant',
      })
    ).resolves.toBeNull();
    await expect(
      rejectInvalidRedvaultLivePilotSnapshot({
        redvaultRequested: true,
        isLivePilot: false,
        client: {} as never,
        orderId: 'order',
        userId: 'pilot-user',
        merchantId: 'merchant',
      })
    ).resolves.toBeNull();
    expect(gateMocks.verifyRedvaultLivePilotSnapshot).not.toHaveBeenCalled();
  });

  it('passes snapshot rejections through during the live pilot', async () => {
    const rejection = {
      message: 'nope',
      code: 'REDVAULT_UNAVAILABLE',
      status: 409,
    } as const;
    gateMocks.verifyRedvaultLivePilotSnapshot.mockResolvedValueOnce({
      ok: true,
    });
    gateMocks.verifyRedvaultLivePilotSnapshot.mockResolvedValueOnce({
      ok: false,
      rejection,
    });
    const input = {
      redvaultRequested: true,
      isLivePilot: true,
      client: {} as never,
      orderId: 'order',
      userId: 'pilot-user',
      merchantId: 'merchant',
    };
    await expect(
      rejectInvalidRedvaultLivePilotSnapshot(input)
    ).resolves.toBeNull();
    await expect(
      rejectInvalidRedvaultLivePilotSnapshot(input)
    ).resolves.toEqual(rejection);
    expect(gateMocks.verifyRedvaultLivePilotSnapshot).toHaveBeenCalledWith({
      client: {} as never,
      orderId: 'order',
      userId: 'pilot-user',
      merchantId: 'merchant',
    });
  });

  it('passes funding rejections through during the live pilot', () => {
    const rejection = {
      message: 'nope',
      code: 'REDVAULT_UNAVAILABLE',
      status: 409,
    } as const;
    gateMocks.verifyRedvaultLivePilotFunding.mockReturnValueOnce({ ok: true });
    gateMocks.verifyRedvaultLivePilotFunding.mockReturnValueOnce({
      ok: false,
      rejection,
    });
    const input = {
      redvaultRequested: true,
      isLivePilot: true,
      walletAmountUsed: 0,
      savingsAmountUsed: 0,
    };
    expect(rejectInvalidRedvaultLivePilotFunding(input)).toBeNull();
    expect(rejectInvalidRedvaultLivePilotFunding(input)).toEqual(rejection);
    expect(
      rejectInvalidRedvaultLivePilotFunding({
        ...input,
        redvaultRequested: false,
      })
    ).toBeNull();
    expect(
      rejectInvalidRedvaultLivePilotFunding({ ...input, isLivePilot: false })
    ).toBeNull();
    expect(gateMocks.verifyRedvaultLivePilotFunding).toHaveBeenCalledWith({
      walletAmountUsed: 0,
      savingsAmountUsed: 0,
    });
  });

  it('builds the callback URL from server environment', () => {
    vi.stubEnv('BACI_RUNTIME_ENV', 'staging');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'preview.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('REDVAULT_LOCAL_CALLBACK_HOSTS', '10.0.2.2, 192.168.1.10');
    gateMocks.getRedvaultCallbackUrl.mockReturnValue('https://cb/success');
    expect(
      buildRedvaultLivePilotCallbackUrl({
        merchantSlug: 'ogabassey',
        protocol: 'https',
        rootDomain: 'usebaci.com',
      })
    ).toBe('https://cb/success');
    expect(gateMocks.getRedvaultCallbackUrl).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      protocol: 'https',
      rootDomain: 'usebaci.com',
      runtimeEnv: 'staging',
      vercelEnv: 'preview',
      vercelUrl: 'preview.vercel.app',
      localBaseUrl: 'http://localhost:3000',
      localAllowedHosts: ['10.0.2.2', '192.168.1.10'],
    });
  });

  it('preserves attempts only for live-pilot REDVAULT initializations', () => {
    expect(
      preserveRedvaultLivePilotAttempts({
        redvaultRequested: true,
        isLivePilot: true,
      })
    ).toBe(true);
    expect(
      preserveRedvaultLivePilotAttempts({
        redvaultRequested: false,
        isLivePilot: true,
      })
    ).toBe(false);
    expect(
      preserveRedvaultLivePilotAttempts({
        redvaultRequested: true,
        isLivePilot: false,
      })
    ).toBe(false);
  });
});
