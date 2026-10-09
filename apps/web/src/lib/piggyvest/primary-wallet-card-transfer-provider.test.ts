import { describe, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { createPrimaryCardTransferProvider } from './primary-wallet-card-transfer-provider';

describe('documented primary wallet transfer adapter', () => {
  it.each([
    { amountKobo: 1 },
    { sourceWalletId: 'foreign' },
    { destinationWalletId: 'foreign' },
    { reference: 'another-ref' },
  ])('refuses changed immutable command before HTTP %#', async (change) => {
    const fetchImplementation = vi.fn();
    await expect(
      createPrimaryCardTransferProvider({
        configuration: fixture.configuration,
        fetchImplementation,
        now: () => fixture.now,
      })({ ...fixture.command, ...change }, fixture.context)
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('dispatches pre-expiry transfers past the integration deadline', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: true }), { status: 200 })
      );
    await createPrimaryCardTransferProvider({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => Date.parse(fixture.configuration.runtime.expiresAt),
    })(fixture.command, fixture.context);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
