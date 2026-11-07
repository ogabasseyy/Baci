import { runWithPinProof } from './wallet-pin-proof';

const request = {
  merchantId: 'm',
  goalId: 'g',
  operationId: 'o',
  amountKobo: 1,
};

// With the server keeping PiggyVest off, a contribution is refused as "not
// ready" and the legacy fallback owns it: the PIN helper must not interfere.
describe('server keeps PiggyVest off', () => {
  it('rethrows the not-ready refusal unchanged without ever prompting', async () => {
    const notReady = Object.assign(new Error('not ready'), {
      code: 'PIGGYVEST_NOT_READY',
    });
    const run = jest.fn().mockRejectedValue(notReady);
    const ask = jest.fn();
    await expect(runWithPinProof(run, request, ask)).rejects.toBe(notReady);
    expect(ask).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('passes a successful legacy-style result straight through', async () => {
    const run = jest.fn().mockResolvedValue({ legacy: true });
    await expect(runWithPinProof(run, request)).resolves.toEqual({
      legacy: true,
    });
    expect(run).toHaveBeenCalledWith(undefined);
  });

  it('rethrows a not-ready refusal for a goal-action request without prompting', async () => {
    const notReady = Object.assign(new Error('not ready'), {
      code: 'PIGGYVEST_NOT_READY',
    });
    const ask = jest.fn();
    await expect(
      runWithPinProof(
        jest.fn().mockRejectedValue(notReady),
        { action: 'complete', merchantId: 'm', goalId: 'g', operationId: 'o' },
        ask
      )
    ).rejects.toBe(notReady);
    expect(ask).not.toHaveBeenCalled();
  });
});
