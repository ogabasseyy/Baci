import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { evalMock, redisConstructor } = vi.hoisted(() => ({
  evalMock: vi.fn(),
  redisConstructor: vi.fn(),
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(options: unknown) {
      redisConstructor(options);
    }
    eval = evalMock;
  },
}));

describe('distributed address provider budgets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of [
      'ADDRESS_AUTOCOMPLETE_REDIS_REST_URL',
      'ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
    ])
      vi.stubEnv(key, '');
    evalMock.mockResolvedValue(1);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('denies all provider calls when distributed storage is missing', async () => {
    const budget = await import('./provider-budget');
    expect(await budget.reserveGooglePlacesRequest('autocomplete')).toBe(false);
    expect(await budget.reserveGeoapifyRequest()).toBe(false);
    expect(evalMock).not.toHaveBeenCalled();
  });
  it('uses the existing Vercel KV integration and a shared Google counter', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-test-token');
    const budget = await import('./provider-budget');
    expect(await budget.reserveGooglePlacesRequest('autocomplete')).toBe(true);
    expect(await budget.reserveGooglePlacesRequest('details')).toBe(true);
    expect(redisConstructor).toHaveBeenCalledWith({
      url: 'https://kv.test',
      token: 'kv-test-token',
    });
    expect(evalMock.mock.calls[0][1]).toEqual(evalMock.mock.calls[1][1]);
    expect(evalMock.mock.calls[0][2][0]).toBe(4400);
    expect(evalMock.mock.calls[1][2][0]).toBe(4500);
  });
  it('uses the Pacific billing month at the UTC month boundary', async () => {
    const { googleBudgetKey } = await import('./provider-budget');
    expect(googleBudgetKey(new Date('2026-10-01T06:59:59Z'))).toBe(
      'baci:address-budget:google:2026-09'
    );
    expect(googleBudgetKey(new Date('2026-10-01T07:00:00Z'))).toBe(
      'baci:address-budget:google:2026-10'
    );
  });
  it('prefers dedicated counters without changing existing KV consumers', async () => {
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_REDIS_REST_URL', 'https://address.test');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN', 'address-token');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    const budget = await import('./provider-budget');
    expect(await budget.reserveGooglePlacesRequest('details')).toBe(true);
    expect(redisConstructor).toHaveBeenCalledWith({
      url: 'https://address.test',
      token: 'address-token',
    });
  });
  it('fails closed without writing a malformed billing-month key', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue(
      []
    );
    const budget = await import('./provider-budget');
    expect(() => budget.googleBudgetKey()).toThrow('billing month unavailable');
    expect(await budget.reserveGooglePlacesRequest('autocomplete')).toBe(false);
    expect(evalMock).not.toHaveBeenCalled();
  });
  it('fails closed rather than mixing credentials from different databases', async () => {
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_REDIS_REST_URL', 'https://address.test');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    const budget = await import('./provider-budget');
    expect(await budget.reserveGeoapifyRequest()).toBe(false);
    expect(redisConstructor).not.toHaveBeenCalled();
  });
  it('reserves Geoapify calls in an atomic rolling day with request spacing', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-test-token');
    const budget = await import('./provider-budget');
    expect(await budget.reserveGeoapifyRequest()).toBe(true);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('TIME')"),
      ['baci:address-budget:geoapify'],
      [86400000, 2800, 250, expect.any(String)]
    );
  });
  it('denies calls when Redis reports exhaustion or throws', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-test-token');
    const budget = await import('./provider-budget');
    evalMock
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('unavailable'));
    expect(await budget.reserveGooglePlacesRequest('details')).toBe(false);
    expect(await budget.reserveGeoapifyRequest()).toBe(false);
  });
  it('paces a concurrent Geoapify request and retries its reservation once', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    const budget = await import('./provider-budget');
    evalMock.mockResolvedValueOnce(-180).mockResolvedValueOnce(1);
    const reservation = budget.reserveGeoapifyRequest();
    await vi.advanceTimersByTimeAsync(179);
    expect(evalMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reservation).toBe(true);
    expect(evalMock).toHaveBeenCalledTimes(2);
  });
  it('stops after one pacing retry if another request wins the slot', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    const budget = await import('./provider-budget');
    evalMock.mockResolvedValueOnce(-250).mockResolvedValueOnce(-150);
    const reservation = budget.reserveGeoapifyRequest();
    await vi.advanceTimersByTimeAsync(250);
    expect(await reservation).toBe(false);
    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not wait or retry when the Geoapify daily limit is reached', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    const budget = await import('./provider-budget');
    evalMock.mockResolvedValueOnce(0);
    expect(await budget.reserveGeoapifyRequest()).toBe(false);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
