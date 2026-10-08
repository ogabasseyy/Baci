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
  it('rechecks expiry at actual HTTP boundary', async () => {
    const fetchImplementation = vi.fn();
    await expect(
      createPrimaryCardTransferProvider({
        configuration: fixture.configuration,
        fetchImplementation,
        now: () => Date.parse(fixture.configuration.runtime.expiresAt),
      })(fixture.command, fixture.context)
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
