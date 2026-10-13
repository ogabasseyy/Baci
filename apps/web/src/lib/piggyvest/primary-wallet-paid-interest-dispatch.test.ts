import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { dispatchPrimaryWalletPaidInterest } from './primary-wallet-paid-interest-dispatch';

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  involved: vi.fn(),
  resolveCrosswalk: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-paid-interest-runtime', () => ({
  readPrimaryWalletPaidInterestRuntime: mocks.runtime,
}));
vi.mock('./primary-wallet-paid-interest-store', () => ({
  createPrimaryWalletPaidInterestStore: () => ({
    involved: mocks.involved,
    resolveCrosswalk: mocks.resolveCrosswalk,
    apply: mocks.apply,
  }),
}));
const rawBody = Buffer.from(JSON.stringify(fixture.event));
const signature = createHmac('sha512', fixture.config.webhookSecret)
  .update(rawBody)
  .digest('hex');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue(fixture.config);
  mocks.involved.mockResolvedValue(true);
  mocks.resolveCrosswalk.mockResolvedValue(fixture.crosswalk);
  mocks.apply.mockResolvedValue('credited');
});
it('connects a signed production payout to authenticated GET wallet evidence and atomic production intake', async () => {
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(fixture.wallet), { status: 200 })
    );
  expect(
    await dispatchPrimaryWalletPaidInterest({
      rawBody,
      signature,
      fetchImplementation,
    })
  ).toBe('credited');
  expect(fetchImplementation).toHaveBeenCalledWith(
    'https://api.piggyvest.business/api/v1/wallet/exact-api-wallet-with-hyphens',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: `Bearer ${fixture.config.providerToken}`,
      }),
    })
  );
  expect(mocks.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      apiWalletId: fixture.wallet.data.id,
      netKobo: 3000,
    })
  );
});
it('does no provider or database work when explicitly disabled', async () => {
  mocks.runtime.mockReturnValue(null);
  const fetchImplementation = vi.fn();
  expect(
    await dispatchPrimaryWalletPaidInterest({
      rawBody,
      signature,
      fetchImplementation,
    })
  ).toBe('disabled');
  expect(fetchImplementation).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});
it('does not credit after provider authentication failure', async () => {
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 401 }));
  await expect(
    dispatchPrimaryWalletPaidInterest({
      rawBody,
      signature,
      fetchImplementation,
    })
  ).rejects.toThrow('reconciliation unavailable');
  expect(mocks.apply).not.toHaveBeenCalled();
});
