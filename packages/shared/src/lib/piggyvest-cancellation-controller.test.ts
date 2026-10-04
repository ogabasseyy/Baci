import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestCancellationController } from './piggyvest-cancellation-controller';

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId: operationId,
    device: { productName: 'Synthetic', variant: '256GB', condition: 'New' },
    terms: { version: 'synthetic', hash: 'a'.repeat(64), text: 'Synthetic' },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
};
const quote = {
  status: 'quote_available',
  goalId,
  revisionId: operationId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};
const receipt = {
  status: 'prepared',
  goalId,
  operationId,
  collectionPaused: true,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};
function fixture() {
  const prepare = vi.fn(async () => receipt);
  const controller = createPiggyvestCancellationController({
    source,
    tenantKey: 'synthetic-tenant',
    operationId,
    quote,
    prepare,
    isCurrent: () => true,
  });
  return { prepare, controller };
}
describe('authenticated cancellation controller lifetime', () => {
  it('notifies before dispatch, isolates listener throws and removes unsubscribed listeners', async () => {
    const test = fixture();
    const states: boolean[] = [];
    const unsubscribe = test.controller.subscribe(() =>
      states.push(test.controller.getFundingBlocked())
    );
    test.controller.subscribe(() => {
      throw new Error('listener');
    });
    test.prepare.mockImplementation(async () => {
      expect(states).toEqual([true]);
      return receipt;
    });
    expect(test.controller.getFundingBlocked()).toBe(false);
    const view = test.controller.read(source);
    if (view?.status !== 'review') throw new Error('fixture');
    await test.controller.prepare(view.command);
    expect(states).toEqual([true, true]);
    expect(test.prepare).toHaveBeenCalledTimes(1);
    await test.controller.prepare(view.command);
    expect(test.prepare).toHaveBeenCalledTimes(1);
    unsubscribe();
    test.controller.invalidate();
    expect(states).toEqual([true, true]);
    expect(test.controller.getFundingBlocked()).toBe(true);
  });
  it('does not reconstruct a prepare command from recovered original disclosure', async () => {
    const {
      status: _status,
      goalId: _goal,
      dispatch: _dispatch,
      interestDisposition: _interest,
      ...originalDisclosure
    } = quote;
    const recovered = {
      status: 'prepared',
      goalId,
      requestedOperationId: null,
      operationId,
      retry: 'not_authorized',
      dispatch: 'contract_gap',
      reservation: 'retained',
      interestDisposition: 'unresolved',
      originalDisclosure,
    };
    const prepare = vi.fn();
    const controller = createPiggyvestCancellationController({
      source,
      tenantKey: 'tenant',
      isCurrent: () => true,
      prepare,
      recover: async () => recovered,
    });
    await controller.recover();
    expect(controller.read(source)).toMatchObject({
      status: 'uncertain',
      recovery: { status: 'prepared' },
    });
    await expect(
      controller.prepare({
        ...originalDisclosure,
        goalId,
        operationId,
        accepted: true,
      })
    ).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    'absent',
    'unavailable',
  ] as const)('never unlocks preparation after recovery %s', async (status) => {
    const recover = vi.fn(async () => ({
      status,
      goalId,
      requestedOperationId: null,
      operationId: null,
      retry: 'not_authorized',
      dispatch: 'contract_gap',
      reservation: status === 'absent' ? 'unknown' : 'may_be_retained',
    }));
    const prepare = vi.fn();
    const controller = createPiggyvestCancellationController({
      source,
      tenantKey: 'tenant',
      isCurrent: () => true,
      recover,
      prepare,
    });
    await controller.recover();
    expect(controller.read(source)).toMatchObject({
      status: 'uncertain',
      recovery: { status, retry: 'not_authorized' },
    });
    await expect(controller.prepare({})).rejects.toThrow();
    expect(recover).toHaveBeenCalledWith({ goalId });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects recovery for another requested operation without enabling prepare', async () => {
    const recover = vi.fn(async () => ({
      status: 'absent',
      goalId,
      requestedOperationId: goalId,
      operationId: null,
      retry: 'not_authorized',
      dispatch: 'contract_gap',
      reservation: 'unknown',
    }));
    const controller = createPiggyvestCancellationController({
      source,
      tenantKey: 'tenant',
      operationId,
      isCurrent: () => true,
      recover,
    });
    await expect(controller.recover()).rejects.toThrow(
      'Cancellation unavailable'
    );
    expect(controller.read(source)).toMatchObject({
      status: 'uncertain',
      recovery: null,
    });
  });
  it('retains the command and cached prepared state across consumer remount', async () => {
    const { controller, prepare } = fixture();
    const view = controller.read(source);
    expect(view?.status).toBe('review');
    if (view?.status !== 'review') throw new Error('fixture');
    await controller.prepare(view.command);
    expect(controller.read(source)?.status).toBe('prepared');
    await controller.prepare(view.command);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('retains unknown without retry or command replacement', async () => {
    const { controller, prepare } = fixture();
    prepare.mockRejectedValueOnce(new Error('private'));
    const view = controller.read(source);
    if (view?.status !== 'review') throw new Error('fixture');
    await expect(controller.prepare(view.command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    expect(controller.read(source)?.status).toBe('uncertain');
    await expect(controller.prepare(view.command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    await expect(
      controller.prepare({ ...view.command, operationId: goalId })
    ).rejects.toThrow();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('invalidates permanently after session switch', () => {
    const { controller } = fixture();
    expect(controller.read({ ...source, sessionKey: 'other' })).toBeNull();
    expect(controller.read(source)).toBeNull();
  });
  it('rejects changed device and changed terms without changing retained command', () => {
    const { controller } = fixture();
    expect(
      controller.read({
        ...source,
        policy: {
          ...source.policy,
          device: { ...source.policy.device, variant: '128GB' },
        },
      })
    ).toBeNull();
    expect(controller.read(source)?.status).toBe('review');
  });
  it('rechecks authenticated lifetime after await without exposing stale receipt', async () => {
    let current = true;
    const prepare = vi.fn(async () => {
      current = false;
      return receipt;
    });
    const controller = createPiggyvestCancellationController({
      source,
      tenantKey: 'tenant',
      operationId,
      quote,
      prepare,
      isCurrent: () => current,
    });
    const view = controller.read(source);
    if (view?.status !== 'review') throw new Error('fixture');
    await expect(controller.prepare(view.command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    expect(controller.read(source)).toBeNull();
  });
});
