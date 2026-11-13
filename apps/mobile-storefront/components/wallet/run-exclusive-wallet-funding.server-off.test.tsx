import { describe, expect, it, jest } from '@jest/globals';
import { runExclusiveWalletFunding } from './run-exclusive-wallet-funding';

// Pure client-side guard: behaves the same with PiggyVest off.
describe('bugfix: double tap started two card checkouts', () => {
  it('drops a second funding for the same account while the first runs', async () => {
    // Arrange: the first funding is still reading storage.
    let release: () => void = () => undefined;
    const first = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const second = jest.fn(async () => undefined);

    // Act
    const running = runExclusiveWalletFunding('m:u', first);
    await runExclusiveWalletFunding('m:u', second);
    release();
    await running;

    // Assert
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('allows the next funding once the first has finished', async () => {
    const action = jest.fn(async () => undefined);
    await runExclusiveWalletFunding('m:u2', action);
    await runExclusiveWalletFunding('m:u2', action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when a funding throws', async () => {
    await expect(
      runExclusiveWalletFunding('m:u3', async () => {
        throw new Error('network');
      })
    ).rejects.toThrow('network');
    const next = jest.fn(async () => undefined);
    await runExclusiveWalletFunding('m:u3', next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
