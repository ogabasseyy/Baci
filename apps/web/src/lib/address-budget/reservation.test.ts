import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reserveAddressProviderRequest } from './reservation';

const mocks = vi.hoisted(() => ({ reply: vi.fn(), createClient: vi.fn() }));
vi.mock('./scoped-client', () => ({
  createAddressBudgetClient: (...args: unknown[]) => {
    mocks.createClient(...args);
    return {
      rpc: (name: string) => {
        if (name !== 'reserve_address_provider_request')
          throw new Error('Unexpected RPC');
        return { abortSignal: mocks.reply };
      },
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T08:00:00Z'));
});
afterEach(() => vi.useRealTimers());
it('accepts only the exact reservation and a fresh dispatch deadline', async () => {
  mocks.reply.mockImplementation(async () => ({
    error: null,
    data: {
      status: 'reserved',
      reservationId: mocks.createClient.mock.lastCall?.[0].reservationId,
      dispatchBefore: Date.now() + 3000,
    },
  }));
  expect(
    (await reserveAddressProviderRequest('google', 'details', 'synthetic-key'))
      .status
  ).toBe('reserved');
  expect(mocks.createClient.mock.lastCall?.[0]).toMatchObject({
    provider: 'google',
    kind: 'details',
    apiKey: 'synthetic-key',
  });
});
it.each([
  {
    status: 'reserved',
    reservationId: '00000000-0000-4000-8000-000000000001',
    dispatchBefore: 1793347203000,
  },
  { status: 'reserved' },
  { status: 'paced', retryAfterMs: 999 },
  { status: 'mystery' },
])('denies malformed or mismatched admission %j', async (data) => {
  mocks.reply.mockResolvedValue({ data, error: null });
  expect(
    await reserveAddressProviderRequest(
      'google',
      'autocomplete',
      'synthetic-key'
    )
  ).toEqual({ status: 'unavailable' });
});
it('does not retry or refund an uncertain committed reservation', async () => {
  mocks.reply.mockRejectedValue(
    new DOMException('synthetic timeout', 'TimeoutError')
  );
  expect(
    await reserveAddressProviderRequest('google', 'details', 'synthetic-key')
  ).toEqual({ status: 'unavailable' });
  expect(mocks.reply).toHaveBeenCalledTimes(1);
});
it('rejects a response that arrives after its dispatch window', async () => {
  mocks.reply.mockImplementation(async () => ({
    error: null,
    data: {
      status: 'reserved',
      reservationId: mocks.createClient.mock.lastCall?.[0].reservationId,
      dispatchBefore: Date.now() - 1,
    },
  }));
  expect(
    await reserveAddressProviderRequest(
      'geoapify',
      'autocomplete',
      'synthetic-key'
    )
  ).toEqual({ status: 'unavailable' });
});
it('retains explicit cap and pacing denials', async () => {
  mocks.reply
    .mockResolvedValueOnce({ error: null, data: { status: 'limit_reached' } })
    .mockResolvedValueOnce({
      error: null,
      data: { status: 'paced', retryAfterMs: 73 },
    });
  expect(
    await reserveAddressProviderRequest(
      'google',
      'autocomplete',
      'synthetic-key'
    )
  ).toEqual({ status: 'limit_reached' });
  expect(
    await reserveAddressProviderRequest(
      'geoapify',
      'autocomplete',
      'synthetic-key'
    )
  ).toEqual({ status: 'paced', retryAfterMs: 73 });
});
