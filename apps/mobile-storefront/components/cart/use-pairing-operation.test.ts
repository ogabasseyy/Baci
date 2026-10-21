import { act, renderHook } from '@testing-library/react-native';
import { usePairingOperation } from './use-pairing-operation';

it('blocks close requests synchronously before the busy render and unlocks after settlement', async () => {
  let finish!: () => void;
  const dismiss = jest.fn();
  const operation = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() => usePairingOperation(dismiss));
  let pending!: Promise<void>;
  act(() => {
    const current = result.current;
    pending = current.run(operation);
    current.dismiss(); // Native back / modal request-close in the same frame.
    void current.run(operation);
  });
  expect(dismiss).not.toHaveBeenCalled();
  expect(operation).toHaveBeenCalledTimes(1);
  expect(result.current.running).toBe(true);
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.running).toBe(false);
  result.current.dismiss();
  expect(dismiss).toHaveBeenCalledTimes(1);
});
it('releases the dismissal fence when the operation rejects', async () => {
  const dismiss = jest.fn();
  const { result } = renderHook(() => usePairingOperation(dismiss));
  await act(async () => {
    await expect(
      result.current.run(async () => {
        throw new Error('offline');
      })
    ).rejects.toThrow('offline');
  });
  result.current.dismiss();
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(result.current.running).toBe(false);
});
