import { walletRefreshWorked } from './wallet-refresh-worked';

// Pure promise handling: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: walletRefreshWorked', () => {
  it('passes a refresh that resolves without an error', async () => {
    await expect(
      walletRefreshWorked(async () => ({ isError: false }))
    ).resolves.toBe(true);
    await expect(walletRefreshWorked(async () => undefined)).resolves.toBe(
      true
    );
  });

  it('fails a refresh that resolves with isError (TanStack refetch)', async () => {
    await expect(
      walletRefreshWorked(async () => ({ isError: true }))
    ).resolves.toBe(false);
  });

  it('fails a refresh that rejects', async () => {
    await expect(
      walletRefreshWorked(async () => {
        throw new Error('offline');
      })
    ).resolves.toBe(false);
  });
});
