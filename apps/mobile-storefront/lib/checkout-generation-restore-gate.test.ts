import { checkoutGenerationRestoreGate } from './checkout-generation-restore-gate';

afterEach(() => {
  jest.useRealTimers();
});

it('records the last restored generation', () => {
  expect(
    checkoutGenerationRestoreGate.lastRestoredGeneration()
  ).toBeUndefined();
  checkoutGenerationRestoreGate.noteRestoredGeneration('restored-gen');
  expect(checkoutGenerationRestoreGate.lastRestoredGeneration()).toBe(
    'restored-gen'
  );
});

it('resolves immediately when no restore is pending', async () => {
  await expect(
    checkoutGenerationRestoreGate.waitForRestore()
  ).resolves.toBeUndefined();
});

it('waits for a pending restore before resolving', async () => {
  let releaseRestore!: () => void;
  const restore = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  checkoutGenerationRestoreGate.noteRestoreStarted(restore);
  let settled = false;
  const waiting = checkoutGenerationRestoreGate.waitForRestore().then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  releaseRestore();
  await waiting;
  expect(settled).toBe(true);
});

it('fails closed when a restore cannot settle in time', async () => {
  jest.useFakeTimers();
  checkoutGenerationRestoreGate.noteRestoreStarted(
    new Promise<never>(() => undefined)
  );
  const waiting = checkoutGenerationRestoreGate.waitForRestore();
  const assertion = expect(waiting).rejects.toThrow(
    'Checkout generation restore timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await assertion;
});
