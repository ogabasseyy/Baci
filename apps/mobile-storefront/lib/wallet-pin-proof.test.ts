import { createHash } from 'node:crypto';
import {
  isPinCancelled,
  type PinProofRequest,
  runWithPinProof,
} from './wallet-pin-proof';

const proof = createHash('sha256').update('s5m-flow-proof').digest('hex');
const request: PinProofRequest = {
  merchantId: 'm',
  goalId: 'g',
  operationId: 'o',
  amountKobo: 5000,
};
const refusal = (code: string) => Object.assign(new Error('refused'), { code });

describe('runWithPinProof', () => {
  it('does not ask for a PIN when the server does not need one', async () => {
    const run = jest.fn().mockResolvedValue('done');
    const ask = jest.fn();
    await expect(runWithPinProof(run, request, ask)).resolves.toBe('done');
    expect(ask).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(undefined);
  });

  it('asks once on PIN_PROOF_REQUIRED and reruns with the proof', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(refusal('PIN_PROOF_REQUIRED'))
      .mockResolvedValueOnce('done');
    const ask = jest.fn().mockResolvedValue(proof);
    await expect(runWithPinProof(run, request, ask)).resolves.toBe('done');
    expect(ask).toHaveBeenCalledWith(request);
    expect(run).toHaveBeenNthCalledWith(2, proof);
  });

  it('asks again when a proof is refused, up to three prompts', async () => {
    const run = jest.fn().mockRejectedValue(refusal('PIN_PROOF_REFUSED'));
    const ask = jest.fn().mockResolvedValue(proof);
    await expect(runWithPinProof(run, request, ask)).rejects.toMatchObject({
      code: 'PIN_PROOF_REFUSED',
    });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('reports a cancelled prompt without running again', async () => {
    const run = jest.fn().mockRejectedValue(refusal('PIN_PROOF_REQUIRED'));
    const error = await runWithPinProof(
      run,
      request,
      jest.fn().mockResolvedValue(null)
    ).catch((e: unknown) => e);
    expect(isPinCancelled(error)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows the refusal when no prompt is available', async () => {
    const run = jest.fn().mockRejectedValue(refusal('PIN_PROOF_REQUIRED'));
    await expect(runWithPinProof(run, request)).rejects.toMatchObject({
      code: 'PIN_PROOF_REQUIRED',
    });
  });

  it.each([
    'WALLET_UNAVAILABLE',
    'SAVINGS_NOT_READY',
    undefined,
  ])('never retries or prompts on %s', async (code) => {
    const run = jest
      .fn()
      .mockRejectedValue(code ? refusal(code) : new Error('network'));
    const ask = jest.fn();
    await expect(runWithPinProof(run, request, ask)).rejects.toBeDefined();
    expect(ask).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('goal-action requests', () => {
  it.each([
    'cancel',
    'complete',
  ] as const)('passes a %s request (no amount) to the prompt unchanged', async (action) => {
    const goalRequest: PinProofRequest = {
      action,
      merchantId: 'm',
      goalId: 'g',
      operationId: 'o',
    };
    const run = jest
      .fn()
      .mockRejectedValueOnce(refusal('PIN_PROOF_REQUIRED'))
      .mockResolvedValueOnce('done');
    const ask = jest.fn().mockResolvedValue(proof);
    await expect(runWithPinProof(run, goalRequest, ask)).resolves.toBe('done');
    expect(ask).toHaveBeenCalledWith(goalRequest);
    expect(run).toHaveBeenNthCalledWith(2, proof);
  });
});
