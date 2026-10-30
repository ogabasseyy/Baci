import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAddressProviderRequest } from '@/lib/address-budget/reservation';
import {
  reserveGeoapifyRequest,
  reserveGooglePlacesRequest,
} from './provider-budget';

vi.mock('@/lib/address-budget/reservation', () => ({
  reserveAddressProviderRequest: vi.fn(),
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      throw new Error('Redis is unavailable');
    }
  },
}));

const reservation = {
  status: 'reserved' as const,
  reservationId: '00000000-0000-4000-8000-000000000001',
  dispatchBefore: 1_800_000_000_000,
};

describe('database-backed address provider budget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_URL', 'https://redis.invalid');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN', 'synthetic-token');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    'autocomplete',
    'details',
  ] as const)('admits authorized Google %s despite Redis failure, using the captured key', async (kind) => {
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue(reservation);
    expect(
      await reserveGooglePlacesRequest(kind, 'captured-google-key')
    ).toEqual({ reserved: true, dispatchBefore: reservation.dispatchBefore });
    expect(reserveAddressProviderRequest).toHaveBeenCalledExactlyOnceWith(
      'google',
      kind,
      'captured-google-key'
    );
  });

  it('preserves the distinction between a verified cap and unavailable allowance', async () => {
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue({
      status: 'limit_reached',
    });
    expect(await reserveGooglePlacesRequest('details', 'google-key')).toEqual({
      reserved: false,
      reason: 'limit_reached',
    });
  });

  it.each([
    'unavailable',
    'duplicate',
  ] as const)('never dispatches Google after %s', async (status) => {
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue({ status });
    expect(
      await reserveGooglePlacesRequest('autocomplete', 'google-key')
    ).toEqual({ reserved: false, reason: 'unavailable' });
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry an uncertain database outcome or use a local development allowance', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(reserveAddressProviderRequest).mockRejectedValue(
      new Error('uncertain commit')
    );
    expect(await reserveGooglePlacesRequest('details', 'google-key')).toEqual({
      reserved: false,
      reason: 'unavailable',
    });
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(1);
  });

  it('reserves Geoapify against its exact captured credential without Redis', async () => {
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue(reservation);
    expect(await reserveGeoapifyRequest('captured-geo-key')).toEqual({
      reserved: true,
      dispatchBefore: reservation.dispatchBefore,
    });
    expect(reserveAddressProviderRequest).toHaveBeenCalledExactlyOnceWith(
      'geoapify',
      'autocomplete',
      'captured-geo-key'
    );
  });

  it('paces Geoapify once, then obtains a fresh durable reservation', async () => {
    vi.useFakeTimers();
    vi.mocked(reserveAddressProviderRequest)
      .mockResolvedValueOnce({ status: 'paced', retryAfterMs: 125 })
      .mockResolvedValueOnce(reservation);
    const pending = reserveGeoapifyRequest('geo-key');
    await vi.advanceTimersByTimeAsync(124);
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({
      reserved: true,
      dispatchBefore: reservation.dispatchBefore,
    });
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(2);
  });

  it('does not loop when another server wins the second Geoapify pacing slot', async () => {
    vi.useFakeTimers();
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue({
      status: 'paced',
      retryAfterMs: 250,
    });
    const pending = reserveGeoapifyRequest('geo-key');
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ reserved: false, reason: 'unavailable' });
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    'unavailable',
    'duplicate',
    'limit_reached',
  ] as const)('does not retry Geoapify after %s', async (status) => {
    vi.mocked(reserveAddressProviderRequest).mockResolvedValue({ status });
    expect(await reserveGeoapifyRequest('geo-key')).toEqual({
      reserved: false,
      reason: status === 'limit_reached' ? 'limit_reached' : 'unavailable',
    });
    expect(reserveAddressProviderRequest).toHaveBeenCalledTimes(1);
  });
});
